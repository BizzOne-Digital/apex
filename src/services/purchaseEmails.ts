import type { Env } from '../config/env.js';
import { Order, type OrderDocument } from '../models/Order.js';
import { Program } from '../models/Program.js';
import { User } from '../models/User.js';
import { mailEnabled, sendMail } from './mailer.js';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const shortId = (orderId: string) => orderId.slice(0, 8).toUpperCase();

/**
 * Confirmation emails after a purchase is fulfilled: one to the customer, one to the owner.
 * Best effort: a mail problem must never undo or block a payment. The order is "claimed" first
 * (emailsSentAt) so polling or a webhook retry can never send them twice; a failed send releases the claim
 * so the reconcile job can try again.
 */
export async function sendPurchaseEmails(env: Env, order: OrderDocument): Promise<void> {
  if (!mailEnabled(env) || order.status !== 'fulfilled') return;
  const claimed = await Order.findOneAndUpdate({ orderId: order.orderId, emailsSentAt: { $exists: false } }, { $set: { emailsSentAt: new Date() } });
  if (!claimed) return;

  try {
    const [user, program] = await Promise.all([User.findById(order.userId), Program.findOne({ slug: order.programSlug })]);
    const programName = program?.name ?? order.programSlug;
    const customerName = user?.name ?? 'there';
    const tax = `Sales Tax (${order.taxRatePercent}%)`;
    const owner = env.OWNER_NOTIFY_EMAIL ?? env.MAIL_FROM ?? env.SMTP_USER;

    const jobs: Promise<void>[] = [];
    if (user?.email) {
      const lines = [
        `Hi ${customerName},`,
        '',
        `Thank you for your purchase. ${programName} is now unlocked in your account. Open the app and log in to start training.`,
        '',
        `Order: ${shortId(order.orderId)}`,
        `${programName}: ${money(order.subtotalCents)}`,
        `${tax}: ${money(order.taxCents)}`,
        `Total paid: ${money(order.totalCents)}`,
        '',
        'This purchase belongs to your account and works on every device you log in on.',
        '',
        'Elite Body Fitness Pros',
      ];
      jobs.push(
        sendMail(env, {
          to: user.email,
          subject: `Your purchase is confirmed: ${programName}`,
          text: lines.join('\n'),
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111">
<h2 style="margin:0 0 12px">Thank you for your purchase</h2>
<p>Hi ${esc(customerName)}, <strong>${esc(programName)}</strong> is now unlocked in your account. Open the app and log in to start training.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:6px 0;color:#555">Order</td><td style="text-align:right">${shortId(order.orderId)}</td></tr>
<tr><td style="padding:6px 0;color:#555">${esc(programName)}</td><td style="text-align:right">${money(order.subtotalCents)}</td></tr>
<tr><td style="padding:6px 0;color:#555">${esc(tax)}</td><td style="text-align:right">${money(order.taxCents)}</td></tr>
<tr><td style="padding:8px 0;border-top:1px solid #ddd"><strong>Total paid</strong></td><td style="text-align:right;border-top:1px solid #ddd"><strong>${money(order.totalCents)}</strong></td></tr>
</table>
<p style="color:#555;font-size:13px">This purchase belongs to your account and works on every device you log in on.</p>
<p style="color:#555;font-size:13px">Elite Body Fitness Pros</p></div>`,
        })
      );
    }
    if (owner) {
      const text = [
        'New purchase received.',
        '',
        `Program: ${programName}`,
        `Customer: ${customerName} (${user?.email ?? 'unknown'})`,
        `Subtotal: ${money(order.subtotalCents)}`,
        `${tax}: ${money(order.taxCents)}`,
        `Total paid: ${money(order.totalCents)}`,
        `Order: ${shortId(order.orderId)}`,
      ].join('\n');
      jobs.push(
        sendMail(env, {
          to: owner,
          subject: `New purchase: ${programName} (${money(order.totalCents)})`,
          text,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;color:#111"><h3>New purchase received</h3><pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre></div>`,
        })
      );
    }

    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) throw new Error((failed[0] as PromiseRejectedResult).reason?.message ?? 'send failed');
  } catch (e) {
    console.error('[mail] purchase email failed', order.orderId, (e as Error).message);
    await Order.updateOne({ orderId: order.orderId }, { $unset: { emailsSentAt: '' } }).catch(() => undefined); // let reconcile retry
  }
}
