import { renderInterim, type InterimJob } from './interim-render';

const scope = globalThis as unknown as {
  onmessage: ((event: { data: InterimJob }) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
  void renderInterim(event.data).then((result) => scope.postMessage(result));
};
