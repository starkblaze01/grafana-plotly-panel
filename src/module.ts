/* -*- Mode: typescript; indent-tabs-mode: nil; typescript-indent-level: 2 -*- */

///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import {MetricsPanelCtrl} from 'app/plugins/sdk';

import _ from 'lodash';
import $ from 'jquery';

import {
  SeriesWrapper,
  SeriesWrapperSeries,
  SeriesWrapperTable,
  SeriesWrapperTableRow,
} from './SeriesWrapper';
import {EditorHelper} from './editor';

import {loadPlotly, loadIfNecessary} from './libLoader';

let Plotly: any; // Loaded dynamically!

class PlotlyPanelCtrl extends MetricsPanelCtrl {
  static templateUrl = 'partials/module.html';

  initialized: boolean;

  static defaults = {
    pconfig: {
      loadFromCDN: false,
      traces: [{}],
      layout: {},
      options: {
        displayModeBar: false,
        displaylogo: false,
        modeBarButtonsToRemove: [
          'sendDataToCloud',
        ],
        showLink: false,
      },
    },
  };

  graphDiv: any;
  series: SeriesWrapper[];
  seriesByKey: Map<string, SeriesWrapper> = new Map();
  seriesHash = '?';

  traces: any[]; // The data sent directly to Plotly -- with a special __copy element
  layout: any; // The layout used by Plotly

  mouse: any;
  cfg: any;

  // For editor
  editor: EditorHelper;
  dataWarnings: string[]; // warnings about loading data

  /** @ngInject **/
  constructor(
    $scope,
    $injector,
    $window,
    public uiSegmentSrv,
  ) {
    super($scope, $injector);

    this.initialized = false;

    // defaults configs
    _.defaultsDeep(this.panel, PlotlyPanelCtrl.defaults);

    this.cfg = this.panel.pconfig;

    this.traces = [];

    loadPlotly(this.cfg).then(v => {
      Plotly = v;
      console.log('Plotly', v);

      // Wait till plotly exists has loaded before we handle any data
      this.events.on('render', this.onRender.bind(this));
      this.events.on('data-received', this.onDataReceived.bind(this));
      this.events.on('data-error', this.onDataError.bind(this));
      this.events.on('panel-size-changed', this.onResize.bind(this));
      this.events.on('data-snapshot-load', this.onDataSnapshotLoad.bind(this));
      this.events.on('refresh', this.onRefresh.bind(this));

      // Refresh after plotly is loaded
      this.refresh();
    });

    // Standard handlers
    this.events.on('init-edit-mode', this.onInitEditMode.bind(this));
    this.events.on('panel-initialized', this.onPanelInitialized.bind(this));
  }

  getCssRule(selectorText): CSSStyleRule | null {
    const styleSheets = document.styleSheets;
    for (let idx = 0; idx < styleSheets.length; idx += 1) {
      const styleSheet = styleSheets[idx] as CSSStyleSheet;
      const rules = styleSheet.cssRules;
      for (let ruleIdx = 0; ruleIdx < rules.length; ruleIdx += 1) {
        const rule = rules[ruleIdx] as CSSStyleRule;
        if (rule.selectorText === selectorText) {
          return rule;
        }
      }
    }
    return null;
  }

  // Don't call resize too quickly
  doResize = _.debounce(() => {
    // https://github.com/alonho/angular-plotly/issues/26
    const e = window.getComputedStyle(this.graphDiv).display;
    if (!e || 'none' === e) {
      // not drawn!
      console.warn('resize a plot that is not drawn yet');
    } else {
      const rect = this.graphDiv.getBoundingClientRect();
      this.layout.width = rect.width;
      this.layout.height = this.height;
      Plotly.redraw(this.graphDiv);
    }
  }, 50);

  onResize() {
    if (this.graphDiv && this.layout && Plotly) {
      this.doResize(); // Debounced
    }
  }

  onDataError(err) {
    this.series = [];
    this.render();
  }

  onRefresh() {
    // ignore fetching data if another panel is in fullscreen
    if (this.otherPanelInFullscreenMode()) {
      return;
    }

    if (this.graphDiv && this.initialized && Plotly) {
      Plotly.redraw(this.graphDiv).then(() => {
        this.renderingCompleted();
      });
    }
  }

  onInitEditMode() {
    this.editor = new EditorHelper(this);
    this.addEditorTab('Display', 'public/plugins/grafana-plotly-panel/partials/tab_display.html', 2);
    this.addEditorTab('Traces', 'public/plugins/grafana-plotly-panel/partials/tab_traces.html', 3);
    this.onConfigChanged(); // Sets up the axis info

    // Check the size in a little bit
    setTimeout(() => {
      console.log('RESIZE in editor');
      this.onResize();
    }, 500);
  }

  onPanelInitialized() {
    this._updateTraceData(true);
  }

  deepCopyWithTemplates = obj => {
    if (_.isArray(obj)) {
      return obj.map(val => this.deepCopyWithTemplates(val));
    } else if (_.isString(obj)) {
      return this.templateSrv.replace(obj, this.panel.scopedVars);
    } else if (_.isObject(obj)) {
      const copy = {};
      _.forEach(obj, (v, k) => {
        copy[k] = this.deepCopyWithTemplates(v);
      });
      return copy;
    }
    return obj;
  };

  getProcessedLayout() {
    // Copy from config
    const layout = this.deepCopyWithTemplates(this.cfg.layout);
    layout.plot_bgcolor = 'transparent';
    layout.paper_bgcolor = layout.plot_bgcolor;

    // Update the size
    const rect = this.graphDiv.getBoundingClientRect();
    layout.autosize = false; // height is from the div
    layout.height = this.height;
    layout.width = rect.width;

    layout.xaxis = layout.xaxis || {};
    layout.yaxis = layout.yaxis || {};

    const isDate = layout.xaxis.type === 'date';
    layout.margin = layout.margin || {
      l: layout.yaxis.title ? 50 : 35,
      r: 5,
      t: 0,
      b: layout.xaxis.title ? 65 : isDate ? 40 : 30,
      pad: 2,
    };

    // Set the range to the query window
    if (isDate && !layout.xaxis.range) {
      const range = this.timeSrv.timeRange();
      layout.xaxis.range = layout.xaxis.range || [range.from.valueOf(), range.to.valueOf()];
    }

    // get the css rule of grafana graph axis text
    const labelStyle = this.getCssRule('div.flot-text');
    if (labelStyle) {
      let color = labelStyle.style.color;
      if (!layout.font) {
        layout.font = {};
      }
      layout.font.color = layout.font.color || color;

      // make the grid a little more transparent
      color = $.color
        .parse(color)
        .scale('a', 0.22)
        .toString();

      // set gridcolor (like grafana graph)
      layout.xaxis.gridcolor = layout.xaxis.gridcolor || color;
      layout.yaxis.gridcolor = layout.yaxis.gridcolor || color;
    }

    return layout;
  }

  onRender() {
    // ignore fetching data if another panel is in fullscreen
    if (this.otherPanelInFullscreenMode() || !this.graphDiv) {
      return;
    }

    if (!Plotly) {
      return;
    }

    if (!this.initialized) {
      const options = this.cfg.options;
      this.layout = this.getProcessedLayout();
      Plotly.react(this.graphDiv, this.traces, this.layout, options);
      this.initialized = true;
    } else if (this.initialized) {
      Plotly.redraw(this.graphDiv).then(() => {
        this.renderingCompleted();
      });
    } else {
      console.log('Not initialized yet!');
    }
  }

  onDataSnapshotLoad(snapshot) {
    this.onDataReceived(snapshot);
  }

  onDataReceived(dataList) {
    const finfo: SeriesWrapper[] = [];
    let seriesHash = '/';
    if (dataList && dataList.length > 0) {
      const useRefID = dataList.length === this.panel.targets.length;
      dataList.forEach((series, sidx) => {
        let refId = '';
        if (useRefID) {
          refId = _.get(this.panel, 'targets[' + sidx + '].refId');
          if (!refId) {
            refId = String.fromCharCode('A'.charCodeAt(0) + sidx);
          }
        }
        if (series.columns) {
          for (let i = 0; i < series.columns.length; i++) {
            finfo.push(new SeriesWrapperTable(refId, series, i));
          }
          finfo.push(new SeriesWrapperTableRow(refId, series));
        } else if (series.target) {
          finfo.push(new SeriesWrapperSeries(refId, series, 'value'));
          finfo.push(new SeriesWrapperSeries(refId, series, 'time'));
          finfo.push(new SeriesWrapperSeries(refId, series, 'index'));
        } else {
          console.error('Unsupported Series response', sidx, series);
        }
      });
    }
    this.seriesByKey.clear();
    finfo.forEach(s => {
      s.getAllKeys().forEach(k => {
        this.seriesByKey.set(k, s);
        seriesHash += '$' + k;
      });
    });
    this.series = finfo;

    // Now Process the loaded data
    const hchanged = this.seriesHash !== seriesHash;
    if (hchanged && this.editor) {
      this.editor.selectTrace(this.editor.traceIndex);
    }

    if (hchanged || !this.initialized) {
      this.seriesHash = seriesHash;
    }

    this.onConfigChanged();
  }

  __addCopyPath(trace: any, key: string, path: string) {
    if (key) {
      trace.__set.push({
        key: key,
        path: path,
      });
      const s: SeriesWrapper = this.seriesByKey.get(key);
      if (!s) {
        this.dataWarnings.push('Unable to find: ' + key + ' for ' + trace.name + ' // ' + path);
      }
    }
  }

  // This will update all trace settings *except* the data
  _updateTracesFromConfigs() {
    this.dataWarnings = [];

    // Make sure we have a trace
    if (this.cfg.traces == null || this.cfg.traces.length < 1) {
      this.cfg.traces = [{}];
    }

    this.traces = this.cfg.traces.map((_trace, idx) => {
      const trace = this.deepCopyWithTemplates(_trace) || {};

      trace.__set = [];

      _.forEach(trace.mapping, (value, key) => {
        this.__addCopyPath(trace, value, key);
      });

      return trace;
    });
  }

  // Fills in the required data into the trace values
  _updateTraceData(force = false): boolean {
    if (!this.series) {
      return false;
    }

    if (force || !this.traces || this.traces.length !== this.cfg.traces.length) {
      this._updateTracesFromConfigs();
    }

    // Use zero when the metric value is missing
    // Plotly gets lots of errors when the values are missing
    let zero: any = [];
    this.traces.forEach(trace => {
      if (trace.__set) {
        trace.__set.forEach(v => {
          const s = this.seriesByKey.get(v.key);
          let vals: any[] = zero;
          if (s) {
            vals = s.toArray();
            if (vals && vals.length > zero.length) {
              zero = Array.from(Array(3), () => 0);
            }
          } else {
            if (!this.error) {
              this.error = '';
            }
            this.error += 'Unable to find: ' + v.key + ' (using zeros).  ';
          }
          if (!vals) {
            vals = zero;
          }
          _.set(trace, v.path, vals);
        });
      }
    });

    return true;
  }

  onConfigChanged() {
    // Load JSONs
    if (this.editor) {
      this.cfg.layout = JSON.parse(this.editor.layout);
      this.cfg.options = JSON.parse(this.editor.options);
      this.cfg.traces[this.editor.traceIndex] = JSON.parse(this.editor.trace);
    }

    // Force reloading the traces
    this._updateTraceData(true);

    if (!Plotly) {
      return;
    }

    // Check if the plotly library changed
    loadIfNecessary(this.cfg).then(res => {
      if (res) {
        if (Plotly) {
          Plotly.purge(this.graphDiv);
        }
        Plotly = res;
      }

      // Updates the layout and redraw
      if (this.initialized && this.graphDiv) {
        const options = this.cfg.options;
        this.layout = this.getProcessedLayout();
        Plotly.react(this.graphDiv, this.traces, this.layout, options);
      }

      this.render(); // does not query again!
    });
  }

  link(scope, elem, attrs, ctrl) {
    this.graphDiv = elem.find('.plotly-spot')[0];
    this.initialized = false;
    elem.on('mousemove', evt => {
      this.mouse = evt;
    });
  }
}

export {PlotlyPanelCtrl, PlotlyPanelCtrl as PanelCtrl};
