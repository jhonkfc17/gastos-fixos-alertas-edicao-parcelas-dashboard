export function toCSV(rows, headers) {
  // headers: [{ key, label }]
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    const needsWrap = /[",\n;]/.test(s);
    const out = s.replace(/"/g, '""');
    return needsWrap ? `"${out}"` : out;
  };

  const head = headers.map((h) => esc(h.label)).join(";");
  const lines = rows.map((r) => headers.map((h) => esc(r[h.key])).join(";"));
  return [head, ...lines].join("\n");
}

export function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
