import QRCode from 'qrcode';
/** НБУ №97: формат 002, корекція M, версія 17, коло 25 модулів. */
export async function qrSvg(payload: string): Promise<string> {
  const svg = await QRCode.toString(payload, {
    type: 'svg',
    version: 17,
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 372,
  });
  const mark =
    '<circle cx="46.5" cy="46.5" r="12.5" fill="white"/><path d="M40 39 C43 34 54 35 53 41 C52 45 42 47 41 51 C40 58 51 59 54 54 M37 44 H56 M37 49 H56" fill="none" stroke="black" stroke-width="2.3" stroke-linecap="round"/>';
  return svg.replace('</svg>', mark + '</svg>');
}
