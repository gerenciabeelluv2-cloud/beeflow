// Atualiza os botões de download com as versões mais recentes do GitHub
document.addEventListener('DOMContentLoaded', () => {
  const macDownloadBtn = document.querySelector('a[data-platform="mac"]');
  const windowsDownloadBtn = document.querySelector('a[data-platform="windows"]');
  
  if (macDownloadBtn || windowsDownloadBtn) {
    fetch('https://api.github.com/repos/gerenciabeelluv2-cloud/beeflow/releases/latest')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch release');
        }
        return response.json();
      })
      .then(data => {
        // Atualiza botão Mac com arquivo DMG
        if (macDownloadBtn) {
          const dmgAsset = data.assets.find(asset => asset.name.endsWith('.dmg'));
          if (dmgAsset) {
            macDownloadBtn.href = dmgAsset.browser_download_url;
            const originalText = macDownloadBtn.textContent.replace(/\s*\(v[\d.]+\)\s*$/, '');
            macDownloadBtn.textContent = `${originalText} (v${data.tag_name})`;
          }
        }
        
        // Atualiza botão Windows com arquivo EXE
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
        console.error('Erro ao buscar versão mais recente:', error);
      });
  }
});
