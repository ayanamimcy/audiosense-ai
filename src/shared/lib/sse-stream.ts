export async function consumeSseStream(
  response: Response,
  handlers: {
    onDelta?: (payload: any) => Promise<void> | void;
    onDone?: (payload: any) => Promise<void> | void;
    onError?: (payload: any) => Promise<void> | void;
  },
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming is not available in this browser.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const flushEvent = async (rawEvent: string) => {
    const lines = rawEvent.split(/\r?\n/);
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (!dataLines.length) {
      return;
    }

    const rawData = dataLines.join('\n');
    let payload: any = rawData;
    try {
      payload = JSON.parse(rawData);
    } catch {
      // Keep raw string payload for non-JSON events.
    }

    if (eventName === 'delta') {
      await handlers.onDelta?.(payload);
      return;
    }
    if (eventName === 'done') {
      await handlers.onDone?.(payload);
      return;
    }
    if (eventName === 'error') {
      await handlers.onError?.(payload);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      await flushEvent(rawEvent);
      separatorIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    await flushEvent(buffer);
  }
}
