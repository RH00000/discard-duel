import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui'

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">Discard Duel</h1>
      <p className="max-w-md text-muted-foreground">
        A 2–4 player mahjong discard race. Everyone sees the same hand; whoever finds the best discard fastest wins the round.
      </p>
      <Link to="/play" className={buttonVariants()}>Play</Link>
    </div>
  )
}
