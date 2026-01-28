// Atualiza os botões de download com as versões mais recentes do GitHub
document.addEventListener('DOMContentLoaded', () => {
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
        // Atualiza botão Mac Silicon com arquivo DMG
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
        
        // Atualiza botão Mac Intel com arquivo DMG
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
