export function Logo({ size = 48 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt="Aufgemöbelt Logo"
      style={{ objectFit: 'contain' }}
    />
  )
}
