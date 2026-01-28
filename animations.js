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
  const priceAmounts = document.querySelectorAll(".price-amount[data-plan]");
  const economyPercents = document.querySelectorAll(".economy-percent[data-plan]");
  const economyCash = document.querySelectorAll(".economy-cash[data-plan]");

  const basePlans = {
    individual: { seats: 1, monthly: 1000 },
    team: { seats: 5, monthly: 3550 },
    operation: { seats: 10, monthly: 8200 },
  };
  const referencePerSeat = 1000;

  const formatBRL = (value) =>
    value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  function computePrice(planKey) {
    const plan = basePlans[planKey];
    if (!plan) return null;
    return plan.monthly;
  }

  function updatePricing() {
    priceAmounts.forEach((el) => {
      const planKey = el.dataset.plan;
      const price = computePrice(planKey);
      if (price !== null) {
        el.textContent = formatBRL(price);
      }
    });

    ["team", "operation"].forEach((planKey) => {
      const price = computePrice(planKey);
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
  }

  updatePricing();

  // Fetch latest release and update download buttons
  const macSiliconBtn = document.querySelector('a[data-platform="mac-silicon"]');
  const macIntelBtn = document.querySelector('a[data-platform="mac-intel"]');
  const windowsDownloadBtn = document.querySelector('a[data-platform="windows"]');
  
  if (macSiliconBtn || macIntelBtn || windowsDownloadBtn) {
    fetch('https://api.github.com/repos/gerenciabeelluv2-cloud/beeflow/releases/latest')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch release');
        }
        return response.json();
      })
      .then(data => {
        // Update Mac Silicon download button with DMG file
        if (macSiliconBtn) {
          const siliconPatterns = ['-silicon', '-arm64', '-apple-silicon', '-m1', '-m2', '-m3', 'arm64'];
          const dmgAsset = data.assets.find(asset => {
            const name = asset.name.toLowerCase();
            return asset.name.endsWith('.dmg') && 
                   siliconPatterns.some(pattern => name.includes(pattern));
          });
          if (dmgAsset) {
            macSiliconBtn.href = dmgAsset.browser_download_url;
            const originalText = macSiliconBtn.textContent.replace(/\s*\(v[\d.]+\)\s*$/, '');
            macSiliconBtn.textContent = `${originalText} (v${data.tag_name})`;
          }
        }
        
        // Update Mac Intel download button with DMG file
        if (macIntelBtn) {
          const intelPatterns = ['-intel', '-x64', '-x86_64', 'intel', 'x64'];
          const dmgAsset = data.assets.find(asset => {
            const name = asset.name.toLowerCase();
            return asset.name.endsWith('.dmg') && 
                   intelPatterns.some(pattern => name.includes(pattern));
          });
          if (dmgAsset) {
            macIntelBtn.href = dmgAsset.browser_download_url;
            const originalText = macIntelBtn.textContent.replace(/\s*\(v[\d.]+\)\s*$/, '');
            macIntelBtn.textContent = `${originalText} (v${data.tag_name})`;
          }
        }
        
        // Update Windows download button with EXE file
        if (windowsDownloadBtn) {
          const exeAsset = data.assets.find(asset => asset.name.endsWith('.exe'));
          if (exeAsset) {
            windowsDownloadBtn.href = exeAsset.browser_download_url;
            const originalText = windowsDownloadBtn.textContent.replace(/\s*\(v[\d.]+\)\s*$/, '');
            windowsDownloadBtn.textContent = `${originalText} (v${data.tag_name})`;
          }
        }
      })
      .catch(error => {
        console.error('Error fetching latest release:', error);
        // Keep the original href if fetch fails
      });
  }
});

