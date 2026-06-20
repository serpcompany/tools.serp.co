const DEFAULT_MEDIA_FETCH_ENDPOINT = "/api/media-fetch";

export function getMediaFetchEndpoint() {
  const endpoint = process.env.NEXT_PUBLIC_MEDIA_FETCH_ENDPOINT?.trim();
  return endpoint || DEFAULT_MEDIA_FETCH_ENDPOINT;
}

export function getDownloaderMediaFetchEndpoint() {
  const endpoint = process.env.NEXT_PUBLIC_DOWNLOADER_MEDIA_FETCH_ENDPOINT?.trim();
  return endpoint || getMediaFetchEndpoint();
}
