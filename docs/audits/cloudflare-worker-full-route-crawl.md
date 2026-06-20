# Vercel vs Cloudflare Route Parity Report

Generated: 2026-06-20T03:56:32.549Z

- Vercel URL: https://tools.serp.co
- Cloudflare URL: https://tools-serp-co.serpcompany.workers.dev
- Routes checked: 5667
- Critical findings: 0
- High findings: 0
- Medium findings: 3116

## Mismatches

| route | Vercel | Cloudflare | findings |
| --- | --- | --- | --- |
| / | 200 | 200 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare s-maxage=31536000) |
| /3g2-to-mp4 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-aac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-aiff | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-alac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-amr | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-asf | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-au | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-av1 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-avchd | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-avi | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-caf | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-cdda | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-divx | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-f4v | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-flac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-flv | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-gif | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-hevc | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-m2ts | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-m4a | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-m4r | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-m4v | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mjpeg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mkv | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mov | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mp2 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mp3 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mp4 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mpeg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mpeg2 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mpg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mts | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-mxf | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-oga | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-ogg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-opus | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-rm | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-rmvb | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-ts | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-vob | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-wav | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-webm | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /3gp-to-wma | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-aiff | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-alac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-amr | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-au | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-caf | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-cdda | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-flac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-m4a | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-m4r | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-mp2 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-mp3 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-mp4 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-oga | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-ogg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-opus | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-wav | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aac-to-wma | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ads.txt | 200 | 200 | medium:cache_control_mismatch (Vercel public, max-age=0, Cloudflare public, max-age=0, s-maxage=3600, stale-while-revalidate=86400) |
| /ai-to-arw | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-bmp | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-cr2 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-cr3 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-cur | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-dds | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-dng | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-gif | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-ico | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-jpeg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-jpg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-pdf | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-png | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-png/ | 200 | 200 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare s-maxage=31536000) |
| /ai-to-svg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-svg/ | 200 | 200 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare s-maxage=31536000) |
| /ai-to-tga | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-tif | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-tiff | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /ai-to-webp | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-aac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-aiff | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-alac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-amr | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-au | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-caf | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-cdda | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-flac | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-m4a | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-m4r | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-mp2 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-mp3 | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-mp3/ | 200 | 200 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare s-maxage=31536000) |
| /aif-to-oga | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-ogg | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-opus | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-wav | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |
| /aif-to-wma | 308 | 308 | medium:cache_control_mismatch (Vercel public, max-age=0, must-revalidate, Cloudflare -) |

Report truncated to first 100 mismatched routes. Use JSON output for complete details.
