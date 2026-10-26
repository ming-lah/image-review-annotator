import { reactive } from 'vue';

export function createToast(duration = 2500) {
  const state = reactive({ message: '' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  function dismiss() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    state.message = '';
  }
  function show(message: string) {
    dismiss();
    state.message = message;
    timer = setTimeout(dismiss, duration);
  }
  return { state, show, dismiss };
}
