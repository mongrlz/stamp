export type SseRecord = {
  id?: string;
  event?: string;
  data: unknown;
};

export function parseSseBlock(block: string): SseRecord | null {
  const record: Omit<SseRecord, "data"> & { data?: unknown } = {};
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("id:")) record.id = line.slice(3).trim();
    else if (line.startsWith("event:")) record.event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  const joined = data.join("\n");
  try {
    record.data = JSON.parse(joined);
  } catch {
    record.data = joined;
  }
  return record as SseRecord;
}

export function parseSseText(text: string): SseRecord[] {
  return text
    .split(/\r?\n\r?\n/)
    .map(parseSseBlock)
    .filter((record): record is SseRecord => record !== null);
}

export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseRecord> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const record = parseSseBlock(block);
      if (record) yield record;
    }
  }
}
