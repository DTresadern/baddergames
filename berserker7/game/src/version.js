/* global __BUILD_LABEL__ */

export function showVersion(element) {
  element.textContent = __BUILD_LABEL__;
}
