// Metric assertion helpers.
//
// Prometheus counters/gauges/histograms in this project are process-local and
// the test files share one process, so assertions are always deltas around an
// action. `metricValue` performs a partial label match (only the labels passed
// by the test must match) and can filter histogram series by `metricName`
// suffix, for example `_count`.
//
// Aggregation guidance used by the tests:
//   * sum counters across producer roles,
//   * sum the worker-active gauge,
//   * take the max of queue/outbox gauges because every scheduler reports the
//     same shared Redis/Postgres state.

interface MetricValue {
  labels: Record<string, string | number>;
  value: number;
  metricName?: string;
}

export interface ReadableMetric {
  get(): Promise<{ values: MetricValue[] }>;
}

export type Labels = Record<string, string | number>;

function labelsMatch(
  actual: Record<string, string | number>,
  expected: Labels,
): boolean {
  return Object.entries(expected).every(([key, value]) => String(actual[key]) === String(value));
}

export async function metricValue(
  metric: ReadableMetric,
  labels: Labels = {},
  metricNameSuffix?: string,
): Promise<number> {
  const { values } = await metric.get();

  return values
    .filter((value) => {
      if (metricNameSuffix && !value.metricName?.endsWith(metricNameSuffix)) return false;

      return labelsMatch(value.labels, labels);
    })
    .reduce((total, value) => total + value.value, 0);
}

export async function counterValue(metric: ReadableMetric, labels: Labels = {}): Promise<number> {
  return metricValue(metric, labels);
}

export async function histogramCount(metric: ReadableMetric, labels: Labels = {}): Promise<number> {
  return metricValue(metric, labels, '_count');
}

export async function gaugeValue(metric: ReadableMetric, labels: Labels = {}): Promise<number> {
  return metricValue(metric, labels);
}
