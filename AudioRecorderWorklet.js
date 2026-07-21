class AudioRecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.sampleBuffer = new Float32Array(this.bufferSize);
        this.sampleOffset = 0;
        this.port.onmessage = event => {
            if (event.data?.type === 'flush') {
                this.flushSamples();
                this.port.postMessage({ type: 'flushed' });
            }
        };
    }

    flushSamples() {
        if (this.sampleOffset <= 0) return;
        const samples = this.sampleBuffer.slice(0, this.sampleOffset);
        this.sampleOffset = 0;
        this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    }

    pushSamples(input) {
        let readOffset = 0;
        while (readOffset < input.length) {
            const available = this.bufferSize - this.sampleOffset;
            const count = Math.min(available, input.length - readOffset);
            this.sampleBuffer.set(input.subarray(readOffset, readOffset + count), this.sampleOffset);
            this.sampleOffset += count;
            readOffset += count;

            if (this.sampleOffset >= this.bufferSize) {
                this.flushSamples();
            }
        }
    }

    process(inputs, outputs) {
        const input = inputs[0]?.[0];
        if (input) {
            this.pushSamples(input);
        }

        const output = outputs[0]?.[0];
        if (output) {
            output.fill(0);
        }
        return true;
    }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
