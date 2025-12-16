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

  document.querySelectorAll(".float, .depth-card, .feature-card, .pricing-card, .download-card, .testimonial-card, .print-block, .logos-grid, .hero-visual, .adv-card")
    .forEach((el) => io.observe(el));

  // Parallax leve no hero visual
  const heroWrap = document.querySelector(".hero-dashboard-wrap");
  const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduce = prefersReduce.matches;
  if (heroWrap && !reduce) {
    const heroArea = document.querySelector(".hero-visual") || heroWrap;
    const heroImg = heroWrap.querySelector(".hero-dashboard-img");
    let rafId;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    const dampen = 0.18;
    const maxTilt = 18; // degrees
    const zLift = 28;

    const animate = () => {
      currentX += (targetX - currentX) * dampen;
      currentY += (targetY - currentY) * dampen;
      heroWrap.style.transform = `rotateX(${currentY}deg) rotateY(${currentX}deg) translateZ(${zLift}px) scale(1.035)`;
      if (heroImg) {
        heroImg.style.transform = `translateX(${currentX * 5}px) translateY(${currentY * -5}px) scale(1.035)`;
      }
      rafId = requestAnimationFrame(animate);
    };

    const onMove = (e) => {
      const rect = heroArea.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      targetX = -(x * maxTilt);
      targetY = y * maxTilt;
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
    };

    heroArea.addEventListener("mousemove", onMove);
    heroArea.addEventListener("mouseleave", onLeave);
    animate();

    prefersReduce.addEventListener("change", (ev) => {
      if (ev.matches && rafId) {
        cancelAnimationFrame(rafId);
        heroWrap.style.transform = "none";
        if (heroImg) heroImg.style.transform = "none";
        heroArea.removeEventListener("mousemove", onMove);
        heroArea.removeEventListener("mouseleave", onLeave);
      }
    });
  } else if (heroWrap && reduce) {
    heroWrap.style.transform = "none";
  }

  // Toggle Pricing
  const toggleButtons = document.querySelectorAll(".toggle-option");
  const priceAmounts = document.querySelectorAll(".price-amount[data-plan]");
  const economyPercents = document.querySelectorAll(".economy-percent[data-plan]");
  const economyCash = document.querySelectorAll(".economy-cash[data-plan]");
  const pricingCtas = document.querySelectorAll(".pricing-card a[data-link-mensal][data-link-anual]");
  const cycleNote = document.getElementById("pricing-cycle-note");

  const basePlans = {
    individual: { seats: 1, monthly: 195 },
    team: { seats: 5, monthly: 690 },
    operation: { seats: 10, monthly: 1595 },
  };
  const multipliers = { mensal: 1, anual: 0.8 };
  const referencePerSeat = 195;
  const cycleNotes = {
    mensal: "Plano mensal padrão",
    anual: "Anual: 1 ano de atualizações incluídas",
  };

  const formatBRL = (value) =>
    value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  function computePrice(planKey, cycle) {
    const plan = basePlans[planKey];
    if (!plan) return null;
    const multiplier = multipliers[cycle] ?? 1;
    return plan.monthly * multiplier;
  }

  function updatePricing(cycle) {
    // update toggle state
    toggleButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.cycle === cycle));
    if (cycleNote) cycleNote.textContent = cycleNotes[cycle] || cycleNotes.mensal;

    priceAmounts.forEach((el) => {
      const planKey = el.dataset.plan;
      const price = computePrice(planKey, cycle);
      if (price !== null) {
        el.textContent = formatBRL(price);
      }
    });

    ["team", "operation"].forEach((planKey) => {
      const price = computePrice(planKey, cycle);
      if (price === null) return;
      const seats = basePlans[planKey].seats;
      const reference = seats * referencePerSeat;
      const econValue = Math.max(0, reference - price);
      const econPercent = Math.max(0, Math.round((econValue / reference) * 100));

      const percentEl = document.querySelector(`.economy-percent[data-plan="${planKey}"]`);
      const cashEl = document.querySelector(`.economy-cash[data-plan="${planKey}"]`);
      if (percentEl) percentEl.textContent = `${econPercent}%`;
      if (cashEl) cashEl.textContent = formatBRL(econValue);
    });

    // update CTA links
    pricingCtas.forEach((cta) => {
      const mensal = cta.getAttribute("data-link-mensal");
      const anual = cta.getAttribute("data-link-anual");
      if (cycle === "anual" && anual) {
        cta.href = anual;
      } else if (mensal) {
        cta.href = mensal;
      }
    });
  }

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      updatePricing(btn.dataset.cycle || "mensal");
    });
  });

  updatePricing("mensal");
});

