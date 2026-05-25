document.addEventListener('DOMContentLoaded', function() {
  const sidebarLinks = document.querySelectorAll('.sidebar-link');
  sidebarLinks.forEach(link => {
    if (link.getAttribute('href') === window.location.pathname) {
      link.classList.add('active');
    }
    if (window.location.pathname.startsWith('/admin/products') && link.getAttribute('href') === '/admin/products') {
      link.classList.add('active');
    }
  });
});
