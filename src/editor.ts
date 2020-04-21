import _ from 'lodash';

import {PlotlyPanelCtrl} from './module';

const REMOVE_KEY = '-- remove --';

export class EditorHelper {
  traceIndex = 0;
  traces: any[]; // array of configs;

  addMappingInput: string = '';
  mapping: any = {};
  trace: string = '{}';
  layout: string = '{}';
  options: string = '{}';

  /** @ngInject */
  constructor(public ctrl: PlotlyPanelCtrl) {
    this.layout = JSON.stringify(ctrl.cfg.layout, null, 2);
    this.options = JSON.stringify(ctrl.cfg.options, null, 2);
    this.selectTrace(0);
  }

  //-----------------------------------------------------------------------
  // Manage Mappings
  //-----------------------------------------------------------------------
  private updateSegMapping(value, key, updateTrace = false) {
    if (REMOVE_KEY === value || !value || value == null) {
      this.mapping[key] = this.ctrl.uiSegmentSrv.newSegment({
        value: 'Select Metric',
        fake: true,
      });
      value = null; // will set this value later
    } else {
      this.mapping[key] = this.ctrl.uiSegmentSrv.newSegment({
        value: value,
      });
    }

    if (updateTrace) {
      const trace = JSON.parse(this.trace);
      trace.mapping = trace.mapping || {};
      trace.mapping[key] = value;
      this.traces[this.traceIndex] = trace;
      this.trace = JSON.stringify(trace, null, 2);
    }
  }

  addMapping() {
    if (!this.mapping[this.addMappingInput]) {
      this.updateSegMapping(undefined, this.addMappingInput, true);
    }
    this.addMappingInput = '';
  }

  removeMapping(key) {
    delete this.mapping[key];
    const trace = JSON.parse(this.trace);
    trace.mapping = trace.mapping || {};
    delete trace.mapping[key];
    this.trace = JSON.stringify(trace, null, 2);
  }

  // Callback when the query results changed
  //-----------------------------------------------------------------------
  // Manage Traces
  //-----------------------------------------------------------------------

  selectTrace(index: number) {
    this.traces = this.ctrl.cfg.traces;
    if (!this.traces || this.traces.length < 1) {
      this.traces = this.ctrl.cfg.traces = [{}];
    }
    if (index >= this.ctrl.cfg.traces.length) {
      index = this.ctrl.cfg.traces.length - 1;
    }
    const trace = this.ctrl.cfg.traces[index];
    this.traceIndex = index;

    if (!trace.name) {
      trace.name = EditorHelper.createTraceName(index);
    }

    trace.mapping = trace.mapping || {};
    this.mapping = {};
    _.forEach(trace.mapping, (value, key) => {
      this.updateSegMapping(value, key);
    });

    this.trace = JSON.stringify(trace, null, 2);
    this.addMappingInput = '';
    this.ctrl.onConfigChanged();
    this.ctrl.refresh();
  }

  createTrace() {
    const trace: any = {};
    trace.mapping = trace.mapping || {};
    trace.name = EditorHelper.createTraceName(this.ctrl.traces.length);
    this.ctrl.cfg.traces.push(trace);
    this.selectTrace(this.ctrl.cfg.traces.length - 1);
  }

  removeCurrentTrace() {
    if (this.traces.length <= 1) {
      return;
    }

    let i = this.traceIndex;

    this.traces.splice(i, 1);
    if (i >= this.traces.length) {
      i = this.traces.length - 1;
    }
    this.ctrl.onConfigChanged();
    this.ctrl._updateTraceData(true);
    this.selectTrace(i);
    this.ctrl.refresh();
    return;
  }

  static createTraceName(idx: number) {
    return 'Trace ' + (idx + 1);
  }

  //-----------------------------------------------------------------------
  // SERIES
  //-----------------------------------------------------------------------

  getSeriesSegs(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const series: any[] = [];

      series.push(
        this.ctrl.uiSegmentSrv.newSegment({
          fake: true,
          value: REMOVE_KEY,
          series: null,
        })
      );
      this.ctrl.series.forEach(s => {
        series.push(
          this.ctrl.uiSegmentSrv.newSegment({
            value: s.name,
            series: s,
          })
        );
      });

      resolve(series);
    });
  }

  onSeriesChanged(key: string, segment: any) {
    const trace = JSON.parse(this.trace);
    trace.mapping = trace.mapping || {};
    trace.mapping[key] = segment.value;
    this.traces[this.traceIndex] = trace;
    this.trace = JSON.stringify(trace, null, 2);
    this.ctrl.onConfigChanged();
  }
}
