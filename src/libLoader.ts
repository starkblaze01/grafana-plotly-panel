import $script from 'scriptjs';

let loaded: any; // Plotly Library
let wasCDN = false;

export function loadPlotly(cfg: any): Promise<any> {
  if (loaded) {
    console.log('using already loaded value');
    return Promise.resolve(loaded);
  }

  let url = 'public/plugins/grafana-plotly-panel/lib/plotly.min.js';
  if (cfg.loadFromCDN) {
    url = 'https://cdn.plot.ly/plotly-latest.min.js';
  }
  return new Promise((resolve, reject) => {
    $script(url, resolve);
  }).then(res => {
    wasCDN = cfg.loadFromCDN;
    loaded = window['Plotly'];
    return loaded;
  });
}

export function loadIfNecessary(cfg: any): Promise<any> {
  if (!loaded) {
    return loadPlotly(cfg);
  }

  if (wasCDN !== cfg.loadFromCDN) {
    console.log('Use CDN', cfg.loadFromCDN);
    loaded = null;
    return loadPlotly(cfg);
  }

  // No changes
  return Promise.resolve(null);
}
