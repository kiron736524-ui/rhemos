import { redirect } from 'next/navigation';

// 进站自动落到一个 project（MVP：默认项目；点"新项目"再开隔离的新项目）。
export default function Home() {
  redirect('/projects/default');
}
