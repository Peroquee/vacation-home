/**
 * The financial report as a PDF (GitLab #90), drawn with @react-pdf/renderer
 * from content that is already worded and formatted (src/app/(app)/dashboard/
 * report.ts). A4, one column, tables first: an accountant reads figures, and
 * the chart only shows their shape. Server-side only.
 *
 * The built-in Helvetica covers Latin-1 (umlauts, the euro sign) but not the
 * thin spaces Intl puts into date ranges, so text is passed through `plain`.
 */
import {
  Document,
  G,
  Line,
  Page,
  Polyline,
  Rect,
  renderToBuffer,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";

import type { ReportContent } from "@/app/(app)/dashboard/report";

/** The chart palette's light steps (src/app/globals.css --chart-1..3). */
const COLORS = { income: "#2a78d6", expenses: "#eb6834", net: "#1baf7a" };
const INK = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

/** Spaces Helvetica cannot draw become plain ones. */
export const plain = (text: string) => text.replace(/[   ]/g, " ");

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: INK },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, marginTop: 4 },
  generated: { fontSize: 8, color: MUTED, marginTop: 2 },
  heading: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6 },
  kpis: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
  kpi: { width: "33.33%", paddingVertical: 6, paddingRight: 8 },
  kpiLabel: { color: MUTED },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  kpiChange: { fontSize: 8, color: MUTED, marginTop: 1 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 3,
  },
  head: { fontFamily: "Helvetica-Bold" },
  cell: { flex: 1 },
  first: { flex: 2 },
  number: { flex: 1, textAlign: "right" },
  legend: { flexDirection: "row", marginTop: 4, marginBottom: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  swatch: { width: 8, height: 8, marginRight: 4 },
  note: { fontSize: 8, color: MUTED, marginTop: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: MUTED,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <View>
      <View style={[styles.row, styles.head]} fixed>
        {columns.map((c, i) => (
          <Text key={i} style={i === 0 ? styles.first : styles.number}>
            {plain(c)}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={styles.row} wrap={false}>
          {row.map((c, i) => (
            <Text key={i} style={i === 0 ? styles.first : styles.number}>
              {plain(c)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Income and expenses as paired bars, net as a line, on one money axis. */
function MonthsChart({ chart }: { chart: ReportContent["months"]["chart"] }) {
  const { points } = chart;
  if (points.length === 0) return null;
  const width = 515;
  const height = 140;
  const top = Math.max(1, ...points.flatMap((p) => [p.incomeMinor, p.expensesMinor, p.netMinor]));
  const bottom = Math.min(0, ...points.map((p) => p.netMinor));
  const span = top - bottom;
  const y = (minor: number) => ((top - minor) / span) * (height - 16);
  const slot = width / points.length;
  const bar = Math.min(14, slot / 3);
  return (
    <View>
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={MUTED} strokeWidth={0.5} />
        {points.map((p, i) => {
          const x = i * slot + slot / 2;
          return (
            <G key={p.label}>
              <Rect
                x={x - bar - 1}
                y={y(p.incomeMinor)}
                width={bar}
                height={Math.max(0.5, y(0) - y(p.incomeMinor))}
                fill={COLORS.income}
              />
              <Rect
                x={x + 1}
                y={y(p.expensesMinor)}
                width={bar}
                height={Math.max(0.5, y(0) - y(p.expensesMinor))}
                fill={COLORS.expenses}
              />
              <Text x={x} y={height - 2} style={{ fontSize: 7, color: MUTED }} textAnchor="middle">
                {plain(p.label)}
              </Text>
            </G>
          );
        })}
        <Polyline
          points={points.map((p, i) => `${i * slot + slot / 2},${y(p.netMinor)}`).join(" ")}
          stroke={COLORS.net}
          strokeWidth={1.5}
          fill="none"
        />
      </Svg>
      <View style={styles.legend}>
        {(["income", "expenses", "net"] as const).map((key) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: COLORS[key] }]} />
            <Text>{plain(chart.legend[key])}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function FinancialReport({ content }: { content: ReportContent }) {
  const { months, categories, occupancy } = content;
  return (
    <Document title={plain(`${content.title} - ${content.subtitle}`)} author="Vacation Home">
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{plain(content.title)}</Text>
        <Text style={styles.subtitle}>{plain(content.subtitle)}</Text>
        <Text style={styles.generated}>{plain(content.generated)}</Text>

        <View style={styles.kpis}>
          {content.kpis.map((kpi) => (
            <View key={kpi.label} style={styles.kpi}>
              <Text style={styles.kpiLabel}>{plain(kpi.label)}</Text>
              <Text style={styles.kpiValue}>{plain(kpi.value)}</Text>
              {kpi.change || kpi.note ? (
                <Text style={styles.kpiChange}>{plain(kpi.change ?? kpi.note ?? "")}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <Text style={styles.heading}>{plain(months.heading)}</Text>
        <MonthsChart chart={months.chart} />
        <Table
          columns={months.columns}
          rows={months.rows.map((r) => [r.month, r.income, r.expenses, r.net])}
        />

        <Text style={styles.heading} break={months.rows.length > 14}>
          {plain(categories.heading)}
        </Text>
        {categories.rows.length === 0 ? (
          <Text>{plain(categories.empty)}</Text>
        ) : (
          <Table
            columns={categories.columns}
            rows={categories.rows.map((r) => [r.name, r.amount, r.share])}
          />
        )}

        <Text style={styles.heading}>{plain(occupancy.heading)}</Text>
        <Table
          columns={occupancy.columns}
          rows={occupancy.rows.map((r) => [r.month, r.nights, r.rate, r.prior])}
        />
        <Text style={styles.note}>{plain(occupancy.definition)}</Text>

        <View style={styles.footer} fixed>
          <Text>{plain(content.footer)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderFinancialReport(content: ReportContent): Promise<Buffer> {
  return renderToBuffer(<FinancialReport content={content} />);
}
