import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Error carrying a stable machine-readable serial-project code. */
export class SerialProjectError extends HarnessError {
    constructor(code, message, options) {
        super(message, code, options);
    }
}
