// Web Worker for parsing CSV files
self.onmessage = (e) => {
  const { fileContent, options } = e.data;
  const { firstLineContains, removeLeading, removeTrailing, delimiter, decimal, textQualifier } = options;
  try {
    // Helper to parse a single line respecting text qualifier
    const parseCsvLine = (line, delim, qualifier) => {
      const cells = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (qualifier && ch === qualifier) {
          if (inQuotes && i + 1 < line.length && line[i + 1] === qualifier) {
            current += qualifier; // Escaped qualifier
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === delim && !inQuotes) {
          cells.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current);
      return cells.map((cell) => {
        if (!qualifier) return cell;
        const trimmed = cell.trim();
        if (trimmed.startsWith(qualifier) && trimmed.endsWith(qualifier)) {
          return trimmed.substring(1, trimmed.length - 1).split(qualifier + qualifier).join(qualifier);
        }
        return cell;
      });
    };

    let delimChar = ',';
    if (delimiter === 'semicolon') delimChar = ';';
    else if (delimiter === 'tab') delimChar = '\t';

    const qualifierChar = textQualifier === 'doubleQuote' ? '"' : textQualifier === 'singleQuote' ? "'" : null;

    const lines = fileContent.split(/\r\n|\n|\r/);
    const parsedRows = [];
    for (let line of lines) {
      if (line.trim() === '') continue;
      if (removeLeading) line = line.replace(/^\s+/, '');
      if (removeTrailing) line = line.replace(/\s+$/, '');
      parsedRows.push(parseCsvLine(line, delimChar, qualifierChar));
    }
    if (parsedRows.length === 0) throw new Error('No data found in the file after processing.');

    let headerRow;
    if (firstLineContains && parsedRows.length > 0) {
      headerRow = parsedRows.shift();
      if (!headerRow || headerRow.length === 0) throw new Error('Header row is empty or missing.');
    }

    if (parsedRows.length === 0 && !headerRow) throw new Error('The file appears to be empty or contains no valid data rows.');

    const numCols = headerRow ? headerRow.length : (parsedRows.length > 0 ? parsedRows[0].length : 0);
    if (numCols === 0) throw new Error('Could not determine the number of columns. The file might be empty or malformed.');

    // Generate variable definitions
    const variables = [];
    for (let colIndex = 0; colIndex < numCols; colIndex++) {
      const colData = parsedRows.map(row => row[colIndex] || '');
      const variableName = (firstLineContains && headerRow && headerRow[colIndex])
        ? headerRow[colIndex].trim()
        : `VAR${String(colIndex + 1).padStart(3,'0')}`;
      let isNumeric = true;
      let potentialDecimals = 0;
      for (const val of colData) {
        if (val === null || val.trim() === '') continue;
        const processedVal = decimal === 'comma' ? val.replace(',', '.') : val;
        if (isNaN(Number(processedVal))) { isNumeric = false; break; }
        const parts = processedVal.split('.');
        if (parts.length > 1) potentialDecimals = Math.max(potentialDecimals, parts[1].length);
      }
      const newVar = {
        columnIndex: colIndex,
        name: variableName,
        type: isNumeric ? 'NUMERIC' : 'STRING',
        // reduce, bukan Math.max(...colData): spread ratusan ribu argumen melampaui stack Web Worker
        width: isNumeric ? 8 : Math.min(32767, Math.max(8, colData.reduce((max, v) => Math.max(max, String(v ?? '').length), 0), variableName.length)),
        decimals: isNumeric ? Math.min(potentialDecimals,16) : 0,
        label: '',
        columns: 72,
        align: isNumeric ? 'right':'left',
        measure: isNumeric ? 'scale':'nominal',
        role: 'input',
        values: [],
        missing: null
      };
      variables.push(newVar);
    }
    // Build processed data
    const data = parsedRows.map(row => row.map((val, idx) => {
      let v = val ?? '';
      const variable = variables[idx];
      // If the variable definition is missing (ragged row), treat as string
      if (variable && variable.type === 'NUMERIC' && String(v).trim() !== '') {
        const proc = decimal === 'comma' ? String(v).replace(',', '.') : String(v);
        v = isNaN(Number(proc)) ? '' : proc;
      }
      return v;
    }));

    self.postMessage({ result: { variables, data } });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
