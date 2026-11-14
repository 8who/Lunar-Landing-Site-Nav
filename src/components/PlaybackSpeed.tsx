interface Props {
  value: number
  onChange: (value: number) => void
  id: string
}

export default function PlaybackSpeed({ value, onChange, id }: Props) {
  return (
    <label className="scrub-speed" htmlFor={id}>
      <span>Speed</span>
      <input
        id={id}
        type="range"
        min="0.25"
        max="4"
        step="0.25"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={`${value} times normal playback speed`}
      />
      <output htmlFor={id}>{value}×</output>
    </label>
  )
}
