import { redirect } from 'next/navigation';

export default function RegisterPage() {
  redirect('/login?error=' + encodeURIComponent('注册功能已禁用'));
}
