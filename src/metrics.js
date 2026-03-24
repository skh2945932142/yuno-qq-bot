function sanitizeLabelValue(value) {
  return String(value ?? 'unknown')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function labelsKey(labels = {}) {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}:${labels[key]}`)
    .join('|');
}

function formatLabels(labels = {}) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }

  return `{${entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${sanitizeLabelValue(value)}"`)
    .join(',')}}`;
}

function createMetricRegistry() {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();

  function ensureMetric(store, name, defaults = {}) {
    if (!store.has(name)) {
      store.set(name, {
        help: defaults.help || name,
        type: defaults.type || 'counter',
        values: new Map(),
        buckets: defaults.buckets || null,
      });
    }

    return store.get(name);
  }

  function incrementCounter(name, value = 1, labels = {}, help = name) {
    const metric = ensureMetric(counters, name, { help, type: 'counter' });
    const key = labelsKey(labels);
    const current = metric.values.get(key) || { labels, value: 0 };
    current.value += value;
    metric.values.set(key, current);
  }

  function setGauge(name, value, labels = {}, help = name) {
    const metric = ensureMetric(gauges, name, { help, type: 'gauge' });
    metric.values.set(labelsKey(labels), { labels, value });
  }

  function observeHistogram(name, value, labels = {}, options = {}) {
    const metric = ensureMetric(histograms, name, {
      help: options.help || name,
      type: 'histogram',
      buckets: options.buckets || [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    });
    const key = labelsKey(labels);
    const current = metric.values.get(key) || {
      labels,
      sum: 0,
      count: 0,
      buckets: metric.buckets.map((bucket) => ({ le: bucket, value: 0 })),
      infCount: 0,
    };

    current.sum += value;
    current.count += 1;

    let bucketMatched = false;
    for (const bucket of current.buckets) {
      if (value <= bucket.le) {
        bucket.value += 1;
        bucketMatched = true;
      }
    }

    if (!bucketMatched) {
      current.infCount += 1;
    }

    metric.values.set(key, current);
  }

  function renderMetricBlock(metricName, metric) {
    const lines = [
      `# HELP ${metricName} ${metric.help}`,
      `# TYPE ${metricName} ${metric.type}`,
    ];

    if (metric.type === 'histogram') {
      for (const entry of metric.values.values()) {
        let cumulative = 0;
        for (const bucket of entry.buckets) {
          cumulative += bucket.value;
          lines.push(`${metricName}_bucket${formatLabels({ ...entry.labels, le: bucket.le })} ${cumulative}`);
        }

        cumulative += entry.infCount;
        lines.push(`${metricName}_bucket${formatLabels({ ...entry.labels, le: '+Inf' })} ${cumulative}`);
        lines.push(`${metricName}_sum${formatLabels(entry.labels)} ${entry.sum}`);
        lines.push(`${metricName}_count${formatLabels(entry.labels)} ${entry.count}`);
      }

      return lines;
    }

    for (const entry of metric.values.values()) {
      lines.push(`${metricName}${formatLabels(entry.labels)} ${entry.value}`);
    }

    return lines;
  }

  return {
    incrementCounter,
    setGauge,
    observeHistogram,
    snapshot() {
      const lines = [];

      for (const [name, metric] of counters) {
        lines.push(...renderMetricBlock(name, metric));
      }
      for (const [name, metric] of gauges) {
        lines.push(...renderMetricBlock(name, metric));
      }
      for (const [name, metric] of histograms) {
        lines.push(...renderMetricBlock(name, metric));
      }

      return `${lines.join('\n')}\n`;
    },
  };
}

export const metrics = createMetricRegistry();

export function recordWorkflowMetric(name, value, labels = {}, type = 'counter') {
  if (type === 'histogram') {
    metrics.observeHistogram(name, value, labels);
    return;
  }

  if (type === 'gauge') {
    metrics.setGauge(name, value, labels);
    return;
  }

  metrics.incrementCounter(name, value, labels);
}
