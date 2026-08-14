/** @type {readonly ['tif-to-png', 'tiff-to-png']} */
export const TIFF_TO_PNG_TOOL_IDS = Object.freeze([
  'tif-to-png',
  'tiff-to-png',
]);
/** @type {readonly ['tif', 'tiff']} */
export const TIFF_INPUT_FORMATS = Object.freeze(['tif', 'tiff']);
export const TIFF_UPLOAD_ACCEPT = '.tif,.tiff';

export function isTiffToPngToolId(value) {
  return TIFF_TO_PNG_TOOL_IDS.includes(value);
}

export function isTiffInputFormat(value) {
  return TIFF_INPUT_FORMATS.includes(value);
}
