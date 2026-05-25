document.addEventListener('DOMContentLoaded', function() {
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');

  if (navToggle) {
    navToggle.addEventListener('click', function() {
      navLinks.classList.toggle('open');
    });
  }

  document.addEventListener('click', function(e) {
    if (navLinks && navLinks.classList.contains('open') && !e.target.closest('.navbar')) {
      navLinks.classList.remove('open');
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
