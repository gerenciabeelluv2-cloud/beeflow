document.addEventListener("DOMContentLoaded", () => {
  // Atualiza ano
  const yearEl = document.getElementById("current-year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Intersection Observer para entradas suaves
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
        }
      });
    },
    { threshold: 0.15 }
  );

  document.querySelectorAll(".float, .depth-card, .feature-card, .pricing-card, .download-card, .testimonial-card, .print-block, .logos-grid, .hero-visual")
    .forEach((el) => io.observe(el));

  // Parallax leve no hero visual
  const heroVisual = document.querySelector(".hero-visual");
  if (heroVisual) {
    window.addEventListener("mousemove", (e) => {
      const { innerWidth, innerHeight } = window;
      const x = (e.clientX - innerWidth / 2) / innerWidth;
      const y = (e.clientY - innerHeight / 2) / innerHeight;
      heroVisual.style.transform = `translate3d(${x * 10}px, ${y * 8}px, 0)`;
    });
  }
});

