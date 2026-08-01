/* ============================================================
   matthewlehman.dev — interactions
   Vanilla JS, no dependencies. Load with a plain <script> tag
   at the end of <body>.

   Contents:
     1. Config
     2. Hero — scroll-driven video scrub
     3. Work — horizontal scroll gallery
     4. Nav (stuck state, active link, mobile menu)
     5. Scroll reveal
     6. Type animations (split text, scramble)
     7. Magnetic hover
     8. Misc (footer clock)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. CONFIG ------------------------------------
     SCRUB SPEED / SMOOTHNESS
     `EASE` is how aggressively the video chases the scroll
     position each frame, 0–1:
        0.06  very floaty, noticeably lags behind the scroll
        0.11  current — smoothest without feeling detached
        0.18  responsive
        0.30  tight, tracks the scroll almost exactly
        1.00  no smoothing at all (jumpy on most machines)

     To change how LONG the hero scrolls for, edit --hero-scroll
     in styles.css instead — that's the scroll distance; this is
     only the easing applied across it.
     --------------------------------------------------------- */
  var EASE = 0.11;

  /* Below this many seconds of difference, stop issuing seeks.
     1/48s sits just under a single frame of 24fps or 30fps video,
     so we never fire two seeks that land on the same frame — that
     redundant decode work is a real source of scrub stutter. */
  var SEEK_EPSILON = 1 / 48;

  // Overlay is fully faded out by this much scroll progress (0–1).
  // Lower = the name/tagline clears out sooner.
  var OVERLAY_FADE_END = 0.3;

  var prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- 2. HERO: SCROLL-DRIVEN VIDEO SCRUB ------------
     The .hero-track is tall; .hero-stage inside it is sticky at
     100vh. How far we've scrolled through the track (0 → 1) maps
     directly onto the video's currentTime (0 → duration).

     Rather than assigning currentTime straight from the scroll
     position (which stutters, because seeks are async and the
     scroll event fires irregularly), we hold a `target` time and
     interpolate a `current` time toward it inside requestAnimation-
     Frame. That gives frame-paced, jank-free scrubbing and lets
     the decoder keep up.
     --------------------------------------------------------- */
  var track   = document.getElementById('heroTrack');
  var stage   = track && track.querySelector('.hero-stage');
  var video   = document.getElementById('heroVideo');

  if (track && stage && video) {
    /* The hero video is the largest asset on the site by an order of
       magnitude. If the visitor has Data Saver on, don't pull it down
       at all — the poster stands in and the headline still reads.
       Everything below degrades cleanly when metadata never arrives. */
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) {
      video.preload = 'none';
    }

    var duration    = 0;      // filled in on loadedmetadata
    var targetTime  = 0;      // where the scroll says we should be
    var currentTime = 0;      // where we've eased to
    var metaReady   = false;
    var inView      = true;   // is the hero on screen at all
    var rafId       = null;

    /* Scroll progress through the track, 0 → 1. */
    function heroProgress() {
      var rect     = track.getBoundingClientRect();
      var scrubble = track.offsetHeight - window.innerHeight;
      if (scrubble <= 0) return 0;
      return clamp(-rect.top / scrubble, 0, 1);
    }

    /* Fade the headline + scroll cue out as the camera falls. */
    function paintOverlay(p) {
      var fade = 1 - clamp(p / OVERLAY_FADE_END, 0, 1);
      stage.style.setProperty('--hero-fade', fade.toFixed(3));
    }

    function frame() {
      var p = heroProgress();
      paintOverlay(p);

      if (metaReady) {
        // Stay a hair short of the very end: some browsers fire
        // `ended` and blank the frame if you land exactly on it.
        targetTime = p * (duration - 0.05);

        currentTime += (targetTime - currentTime) * EASE;

        // Don't queue a new seek while one is still resolving —
        // that's what causes the classic scrub stutter.
        if (!video.seeking &&
            Math.abs(video.currentTime - currentTime) > SEEK_EPSILON) {
          try { video.currentTime = currentTime; } catch (e) { /* seek raced a load */ }
        }
      }

      rafId = inView ? requestAnimationFrame(frame) : null;
    }

    function startLoop() {
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }

    video.addEventListener('loadedmetadata', function () {
      if (!isFinite(video.duration) || video.duration <= 0) return;
      duration  = video.duration;
      metaReady = true;

      // Nudge the decoder awake so the first seek isn't a black frame.
      // Muted + playsinline means this is allowed without a gesture;
      // if a browser refuses, the catch keeps everything else running.
      var kick = video.play();
      if (kick && typeof kick.then === 'function') {
        kick.then(function () { video.pause(); }).catch(function () { /* autoplay blocked */ });
      } else {
        video.pause();
      }

      video.currentTime = 0;
    });

    // Only burn frames while the hero is actually on screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView) startLoop();
      }, { rootMargin: '100px' }).observe(track);
    }

    if (prefersReducedMotion) {
      // No scrub: the track is collapsed to 100vh by CSS, so just
      // park the video on an early frame and leave the overlay up.
      video.addEventListener('loadedmetadata', function () {
        try { video.currentTime = 0.1; } catch (e) {}
      });
      stage.style.setProperty('--hero-fade', '1');
    } else {
      startLoop();
    }

    // If the video can't load at all, the poster stays and the
    // headline sits over it — nothing else breaks.
    video.addEventListener('error', function () {
      metaReady = false;
      stage.style.setProperty('--hero-fade', '1');
    });
  }

  /* ---------- 3. WORK: HORIZONTAL SCROLL GALLERY ------------
     Vertical scroll through the tall .work-track drives the panel
     row sideways — the vanilla equivalent of the Motion example's
     useScroll + useTransform, with the same rAF lerp used by the
     hero so the motion is smoothed rather than snapped.

     The track height is DERIVED, not hardcoded: it's one viewport
     (the pinned screen) plus however far the row actually has to
     travel. Add or remove a .panel and the scroll length retunes
     itself — nothing to update by hand.
     --------------------------------------------------------- */
  var workTrack = document.getElementById('workTrack');
  var gallery   = document.getElementById('workGallery');
  var workBar   = document.getElementById('workBar');
  var workCount = document.getElementById('workCount');

  if (workTrack && gallery && !prefersReducedMotion) {

    /* How smoothly the row chases the scroll. Same 0–1 scale as
       EASE above — lower is silkier and laggier. */
    var GALLERY_EASE = 0.1;

    /* Vertical scroll distance per pixel of sideways travel.
       At 0.6 with full-window panels you spend roughly one screen
       height of scrolling per project, which is about right.
         1.0 = 1:1 with the sideways distance, much longer
         0.4 = blows through the row
       This is the knob for "the work section takes too long". */
    var SCROLL_RATIO = 0.6;

    var travel     = 0;      // px the row must move to show the last panel
    var galleryX   = 0;      // eased position
    var galleryIn  = true;   // is the section on screen
    var galleryRaf = null;

    var panelTotal = gallery.children.length;
    var lastIdx    = 0;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };

    /* Measure the row and size the track to match. offsetWidth is
       the layout width — unaffected by the transform we apply. */
    function measureGallery() {
      /* Panels read their width from this rather than using 100vw.
         vw units ignore the scrollbar, so on desktop each panel
         would sit ~15px wider than the actual viewport and the
         error would compound across the row. */
      document.documentElement.style.setProperty(
        '--panel-w', window.innerWidth + 'px'
      );

      travel = Math.max(0, gallery.offsetWidth - window.innerWidth);
      workTrack.style.height =
        (window.innerHeight + travel * SCROLL_RATIO) + 'px';
    }

    function galleryProgress() {
      var rect     = workTrack.getBoundingClientRect();
      var scrubble = workTrack.offsetHeight - window.innerHeight;
      if (scrubble <= 0) return 0;
      return clamp(-rect.top / scrubble, 0, 1);
    }

    function galleryFrame() {
      var p = galleryProgress();
      var target = -p * travel;

      galleryX += (target - galleryX) * GALLERY_EASE;
      // Snap the last fraction of a pixel so we stop repainting.
      if (Math.abs(target - galleryX) < 0.05) galleryX = target;

      gallery.style.transform =
        'translate3d(' + galleryX.toFixed(2) + 'px, 0, 0)';

      if (workBar) workBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';

      /* Frame counter. Snaps to whichever panel is closest rather
         than counting continuously, and only touches the DOM when
         the number actually changes. */
      if (workCount && panelTotal) {
        var idx = Math.round(p * (panelTotal - 1)) + 1;
        if (idx !== lastIdx) {
          lastIdx = idx;
          workCount.innerHTML = pad(idx) + '<em>/</em>' + pad(panelTotal);
        }
      }

      galleryRaf = galleryIn ? requestAnimationFrame(galleryFrame) : null;
    }

    function startGallery() {
      if (galleryRaf === null) galleryRaf = requestAnimationFrame(galleryFrame);
    }

    measureGallery();
    // Fonts and any late-loading images change the row width.
    window.addEventListener('load', measureGallery);

    // Re-measure on resize / orientation change (debounced).
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measureGallery, 120);
    });

    // Catches reflows that don't fire a window resize.
    if ('ResizeObserver' in window) {
      new ResizeObserver(measureGallery).observe(gallery);
    }

    // Only run the loop while the section is on screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        galleryIn = entries[0].isIntersecting;
        if (galleryIn) startGallery();
      }, { rootMargin: '100px' }).observe(workTrack);
    }

    startGallery();
  }

  /* ---------- 4. NAV ---------------------------------------- */
  var nav = document.getElementById('nav');
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('.nav__links a')
  );

  // Solid background once you've left the top of the page.
  function paintNav() {
    if (!nav) return;
    nav.classList.toggle('is-stuck', window.scrollY > 80);
  }
  paintNav();
  window.addEventListener('scroll', paintNav, { passive: true });

  // Highlight the section you're currently in.
  if ('IntersectionObserver' in window && navLinks.length) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        navLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    ['about', 'work', 'skills'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) sectionObserver.observe(el);
    });
  }

  // Mobile menu
  var navToggle = document.getElementById('navToggle');
  var mobileMenu = document.getElementById('mobileMenu');

  if (navToggle && mobileMenu) {
    var setMenu = function (open) {
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      mobileMenu.dataset.open = String(open);
      mobileMenu.hidden = !open;
    };

    navToggle.addEventListener('click', function () {
      setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
    });

    // Close after tapping a link
    mobileMenu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setMenu(false);
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenu(false);
    });
  }

  /* ---------- 5. SCROLL REVEAL ------------------------------
     Anything with class="reveal" fades/slides in once.
     --------------------------------------------------------- */
  var reveals = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);   // reveal once, then stop watching
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    Array.prototype.forEach.call(reveals, function (el) {
      revealObserver.observe(el);
    });
  } else {
    // No IntersectionObserver (or reduced motion): show everything.
    Array.prototype.forEach.call(reveals, function (el) {
      el.classList.add('is-visible');
    });
  }

  /* ---------- 6. SKILLS BROWSER -----------------------------
     A tablist. Mouse users browse by hovering; keyboard users
     browse with the arrow keys; either way the detail panel
     re-renders. Content lives in data- attributes on the buttons
     so it can be edited in the HTML without touching this file.
     --------------------------------------------------------- */

  /* The only thing skills need from JS: a key -> project lookup,
     so a skill can link to where it's actually used. */
  var PROJECTS = {
    tricounty:  { name: 'Tri County Web Design', url: 'https://tricountywebdesign.com' },
    monumanage: { name: 'MonuManage',            url: 'https://monumanage.com' },
    jrotc:      { name: 'Logan AFJROTC',         url: 'https://loganjrotc.org' },
    mlmedia:    { name: 'Matthew Lehman Media',  url: 'https://matthewlehmanmedia.com' }
  };

  var skillTabs   = Array.prototype.slice.call(document.querySelectorAll('.skill'));
  var skillDetail = document.getElementById('skillDetail');

  if (skillTabs.length && skillDetail) {
    var elNum   = skillDetail.querySelector('.skills__num');
    var elTitle = skillDetail.querySelector('.skills__title');
    var elDesc  = skillDetail.querySelector('.skills__desc');
    var elList  = skillDetail.querySelector('.skills__projects');

    var activeIdx = 0;

    function renderSkill(i) {
      var btn = skillTabs[i];
      if (!btn) return;

      activeIdx = i;

      skillTabs.forEach(function (b, n) {
        b.setAttribute('aria-selected', n === i ? 'true' : 'false');
        // Only the selected tab stays in the tab order
        b.tabIndex = n === i ? 0 : -1;
      });
      skillDetail.setAttribute('aria-labelledby', btn.id);

      elNum.textContent   = (i + 1 < 10 ? '0' : '') + (i + 1);
      elTitle.textContent = btn.textContent.trim();
      elDesc.textContent  = btn.dataset.desc || '';

      elList.textContent = '';
      (btn.dataset.projects || '').split(/\s+/).forEach(function (key) {
        var p = PROJECTS[key];
        if (!p) return;
        var li = document.createElement('li');
        var a  = document.createElement('a');
        a.href = p.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = p.name;
        li.appendChild(a);
        elList.appendChild(li);
      });

      /* Restart the enter animation. Removing the class, forcing a
         reflow, then re-adding it is what makes the transition run
         again on every change — without it the panel only animates
         the first time. */
      if (!prefersReducedMotion) {
        skillDetail.classList.remove('is-in');
        void skillDetail.offsetWidth;
      }
      skillDetail.classList.add('is-in');
    }

    skillTabs.forEach(function (btn, i) {
      btn.addEventListener('click', function () { renderSkill(i); btn.focus(); });
      btn.addEventListener('focus', function () { renderSkill(i); });

      // Hover previews, but only for an actual mouse
      btn.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'mouse') renderSkill(i);
      });

      btn.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % skillTabs.length;
        if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  next = (i - 1 + skillTabs.length) % skillTabs.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End')  next = skillTabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        skillTabs[next].focus();
      });
    });

    // Moving the pointer out of the whole list snaps back to the
    // selected tab, so the panel never strands on a hover preview.
    var skillsIndex = document.querySelector('.skills__index');
    if (skillsIndex) {
      skillsIndex.addEventListener('pointerleave', function (e) {
        if (e.pointerType !== 'mouse') return;
        var focused = skillTabs.indexOf(document.activeElement);
        renderSkill(focused > -1 ? focused : activeIdx);
      });
    }

    renderSkill(0);
  }

  /* ---------- 6b. TYPE ANIMATIONS ---------------------------
     Two effects, both opt-in via an attribute in the HTML:

       data-split     per-character rise. Used on display type
                      (the name, the section titles).
       data-scramble  characters cycle then resolve. Used on mono
                      labels and nav links, where a monospace grid
                      means nothing reflows while it runs.

     Both are skipped entirely under prefers-reduced-motion, and
     both keep the original string on the element for screen
     readers — the per-character spans are aria-hidden.
     --------------------------------------------------------- */

  /* Wrap every character in its own span so each can be animated.
     --i is the character's index; CSS turns that into a delay. */
  function splitChars(el) {
    var text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';

    var frag = document.createDocumentFragment();
    for (var i = 0; i < text.length; i++) {
      var span = document.createElement('span');
      span.className = 'char';
      span.setAttribute('aria-hidden', 'true');
      // Non-breaking space, or the span collapses to zero width
      span.textContent = text[i] === ' ' ? ' ' : text[i];
      span.style.setProperty('--i', i);
      frag.appendChild(span);
    }
    el.appendChild(frag);
    el.classList.add('split');
  }

  var SCRAMBLE_POOL = '!<>-_\\/[]{}=+*^?#________';

  function scramble(el, duration) {
    if (el.dataset.scrambling === '1') return;

    var text = el.dataset.text || el.textContent.trim();
    el.dataset.text = text;
    el.dataset.scrambling = '1';

    var start = performance.now();
    var total = duration || 480;

    function step(now) {
      var p = Math.min((now - start) / total, 1);
      // Characters lock in left-to-right as progress advances
      var settled = Math.floor(p * text.length);
      var out = '';

      for (var i = 0; i < text.length; i++) {
        if (i < settled || text[i] === ' ') {
          out += text[i];
        } else {
          out += SCRAMBLE_POOL[(Math.random() * SCRAMBLE_POOL.length) | 0];
        }
      }
      el.textContent = out;

      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = text;
        el.dataset.scrambling = '0';
      }
    }
    requestAnimationFrame(step);
  }

  if (!prefersReducedMotion) {
    // Split everything tagged, then let the reveal observer below
    // (or an immediate trigger, for the hero) play them in.
    var splitEls = document.querySelectorAll('[data-split]');
    Array.prototype.forEach.call(splitEls, splitChars);

    if ('IntersectionObserver' in window) {
      var splitObserver = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          obs.unobserve(entry.target);
        });
      }, { threshold: 0.4 });

      Array.prototype.forEach.call(splitEls, function (el) {
        splitObserver.observe(el);
      });
    } else {
      Array.prototype.forEach.call(splitEls, function (el) {
        el.classList.add('is-in');
      });
    }

    // Hero label resolves once on load
    var heroLabel = document.querySelector('.hero-label[data-scramble]');
    if (heroLabel) setTimeout(function () { scramble(heroLabel, 700); }, 350);

    // Nav links scramble on hover
    Array.prototype.forEach.call(
      document.querySelectorAll('.nav__links a'),
      function (link) {
        link.addEventListener('mouseenter', function () { scramble(link, 320); });
      }
    );
  }

  /* ---------- 7. MAGNETIC HOVER -----------------------------
     Elements drift toward the pointer while it's over them, then
     spring back. Pointer events only — never bound on touch, where
     there's no hover state to speak of.
     --------------------------------------------------------- */
  function magnetic(el, strength) {
    var s = strength || 0.3;

    el.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = el.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = 'translate(' + (dx * s).toFixed(2) + 'px,' +
                                          (dy * s).toFixed(2) + 'px)';
    });

    var release = function () { el.style.transform = ''; };
    el.addEventListener('pointerleave', release);
    el.addEventListener('blur', release);
  }

  if (!prefersReducedMotion && window.matchMedia('(hover: hover)').matches) {
    var magnets = document.querySelectorAll('.wordmark, .footer__email');
    Array.prototype.forEach.call(magnets, function (el) {
      el.classList.add('is-magnetic');
      magnetic(el, el.classList.contains('wordmark') ? 0.22 : 0.15);
    });
  }

  /* ---------- 8. MISC --------------------------------------- */

  /* Live local time in Logan, Ohio. Uses a fixed IANA zone rather
     than the visitor's clock — the point is where HE is, not where
     they are. */
  var clock = document.getElementById('clock');
  if (clock) {
    var timeFmt;
    try {
      timeFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    } catch (e) { timeFmt = null; }

    if (timeFmt) {
      var tick = function () { clock.textContent = timeFmt.format(new Date()); };
      tick();
      setInterval(tick, 1000);
    } else {
      clock.remove();
    }
  }

  // Footer year
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* Smooth-scroll anchors.
     CSS `scroll-behavior: smooth` already handles this in every
     modern browser; this only exists to keep the URL hash clean
     and to respect reduced-motion. */
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!link) return;

    var id = link.getAttribute('href').slice(1);
    if (!id) return;

    var target = document.getElementById(id);
    if (!target) return;

    e.preventDefault();
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
    history.replaceState(null, '', '#' + id);
  });

})();
