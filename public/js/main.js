document.addEventListener('DOMContentLoaded', function() {
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const navDrawerOverlay = document.getElementById('navDrawerOverlay');

  function openDrawer() {
    navLinks.classList.add('open');
    if (navDrawerOverlay) navDrawerOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    navLinks.classList.remove('open');
    if (navDrawerOverlay) navDrawerOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (navToggle) {
    navToggle.addEventListener('click', function() {
      if (navLinks.classList.contains('open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (navDrawerOverlay) {
    navDrawerOverlay.addEventListener('click', closeDrawer);
  }

  document.addEventListener('click', function(e) {
    if (navLinks && navLinks.classList.contains('open') && !e.target.closest('.nav-links') && !e.target.closest('.nav-toggle')) {
      closeDrawer();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && navLinks && navLinks.classList.contains('open')) {
      closeDrawer();
    }
  });

  const filterLinks = document.querySelectorAll('.filter-btn');
  filterLinks.forEach(link => {
    link.addEventListener('click', function() {
      filterLinks.forEach(l => l.classList.remove('active'));
      this.classList.add('active');
    });
  });
});
