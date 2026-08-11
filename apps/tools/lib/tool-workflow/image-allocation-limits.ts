export const MAX_DECODED_RGBA_BYTES = 64 * 1_024 * 1_024;
export const MAX_IMAGE_DIMENSION = 16_384;

export function decodedAllocationExceeds(
  width: number,
  height: number,
  frames = 1,
): boolean {
  return (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(frames) ||
    width < 1 ||
    height < 1 ||
    frames < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width > Math.floor(MAX_DECODED_RGBA_BYTES / 4 / height / frames)
  );
}
