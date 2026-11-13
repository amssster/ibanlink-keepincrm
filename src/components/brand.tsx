import Image from 'next/image';
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Image src="/project-icon.png" alt="" width={40} height={40} unoptimized />
      </span>
      <span>
        IBAN Link<span className="brand-sub">для KeepinCRM</span>
      </span>
    </div>
  );
}
