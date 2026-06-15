import SerplyCtaButton from "@/components/SerplyCtaButton";
import {
  DOWNLOADER_EXTENSION_LABEL,
  DOWNLOADER_EXTENSION_TEXT,
  DOWNLOADER_EXTENSION_URL,
} from "@/lib/downloader-extension-cta";

type DownloaderExtensionCTAProps = {
  extensionUrl?: string;
};

export default function DownloaderExtensionCTA({
  extensionUrl = DOWNLOADER_EXTENSION_URL,
}: DownloaderExtensionCTAProps) {
  return (
    <section className="sticky top-16 z-40 flex flex-col gap-3 border-b border-[#bfd4ff] bg-[#eef4ff] px-4 py-3 text-left shadow-sm sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:text-left">
      <p className="max-w-2xl text-[0.94rem] font-semibold leading-6 tracking-[-0.01em] text-[#12337a] sm:text-[0.98rem] lg:pr-8 lg:text-[1.04rem]">
        {DOWNLOADER_EXTENSION_TEXT}
      </p>

      <SerplyCtaButton
        href={extensionUrl}
        label={DOWNLOADER_EXTENSION_LABEL}
        size="lg"
        className="h-10 w-full sm:w-auto text-[0.92rem]"
      />
    </section>
  );
}
