class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') {
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (input?.length) {
      this.port.postMessage({ type: 'samples', samples: input.slice(0) });
    }
    return true;
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
