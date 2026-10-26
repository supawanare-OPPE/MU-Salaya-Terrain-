// Coordinates and elevations: Topo64179-3-Cont.pdf, BM table (sheet 1).
// Thai place names supplied by the campus project owner, 26 October 2026.
export const BENCHMARK_SOURCE = Object.freeze({
  drawing: 'Topo64179-3-Cont.pdf',
  crs: 'WGS 84 / UTM Zone 47N',
  verticalDatum: 'รทก. อ้างอิงหมุด กทม. No.6001/1 = +2.753 ม.',
  symbolReference: 'https://www.ordnancesurvey.co.uk/documents/resources/map-makers-britain-history.pdf'
});

export const BENCHMARKS = Object.freeze([
  { id: 'BM1', name: 'ฐานเสาธงหน้า OP', easting: 643383.499, northing: 1525386.538, elevation: 2.135 },
  { id: 'BM2', name: 'ประตู 3 ทางออก', easting: 643445.485, northing: 1525401.555, elevation: 1.594 },
  { id: 'BM3', name: 'เกาะกลางถนนปัญญาแผ่นดิน', easting: 642691.647, northing: 1525874.536, elevation: 1.724 },
  { id: 'BM4', name: 'เกาะกลางสามแยกถนนปัญญาแผ่นดิน', easting: 642693.748, northing: 1525646.286, elevation: 1.087 },
  { id: 'BM5', name: 'ข้างทางเข้าใกล้สนามฟุตบอล 2', easting: 642430.916, northing: 1525443.494, elevation: 0.888 },
  { id: 'BM6', name: 'ข้างทางเข้าใกล้สนามฟุตบอล 1', easting: 642431.505, northing: 1525296.207, elevation: 0.845 },
  { id: 'BM7', name: 'หลังป้ายมหิดลสิทธาคาร', easting: 642812.531, northing: 1525079.920, elevation: 1.103 },
  { id: 'BM8', name: 'ลานหน้ามหิดลสิทธาคาร', easting: 642812.524, northing: 1524950.824, elevation: 2.707 },
  { id: 'BM9', name: 'บริเวณทางเข้า GJ', easting: 643067.374, northing: 1524588.560, elevation: 2.267 },
  { id: 'BM10', name: 'บริเวณศาลพระภูมิ GJ', easting: 642823.886, northing: 1524575.632, elevation: 2.403 }
].map(point => Object.freeze(point)));

// Keep survey Z intact. The SKP placement offset is applied only to the display.
export function benchmarkLocalPosition(point, metadata) {
  return {
    x: point.easting - metadata.utmOffset[0] - metadata.webCenterLocalMetres[0],
    y: point.elevation + (metadata.terrainDisplayOffsetMetres || 0),
    z: -(point.northing - metadata.utmOffset[1] - metadata.webCenterLocalMetres[1])
  };
}

export const MARKER_WIDTH = 80;
export const MARKER_HEIGHT = 40;
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// Label displacement never changes the projected survey point; a leader joins them.
export function layoutBenchmarkLabels(points, width, height, obstacles = []) {
  const occupied = [...obstacles];
  return points.map(point => {
    let best = null, bestScore = Infinity;
    const offsets = [[0, -30], [56, 0], [-56, 0], [0, 32], [56, -38], [-56, -38], [56, 38], [-56, 38], [0, -78], [0, 80], [100, 0], [-100, 0]];
    for (const [dx, dy] of offsets) {
      const x = Math.max(5, Math.min(width - MARKER_WIDTH - 5, point.x + dx - MARKER_WIDTH / 2));
      const y = Math.max(5, Math.min(height - MARKER_HEIGHT - 5, point.y + dy - MARKER_HEIGHT / 2));
      const box = { x, y, width: MARKER_WIDTH, height: MARKER_HEIGHT };
      const collisions = occupied.reduce((sum, other) => sum + overlapArea({ x: x - 3, y: y - 3, width: MARKER_WIDTH + 6, height: MARKER_HEIGHT + 6 }, other), 0);
      const distance = Math.hypot(x + MARKER_WIDTH / 2 - point.x, y + MARKER_HEIGHT / 2 - point.y);
      const score = collisions * 1000 + distance;
      if (score < bestScore) { best = box; bestScore = score; }
    }
    occupied.push(best);
    return { ...point, box: best };
  });
}
