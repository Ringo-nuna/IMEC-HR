/**
 * IMEC People — 일정 메일 자동 발송 스크립트
 * GitHub Actions에서 매일 오전 8시 KST (23:00 UTC)에 실행됩니다.
 *
 * 환경변수 (GitHub Repository Secrets에 등록):
 *   SUPABASE_URL          — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role 키 (비공개)
 *   SMTP_HOST             — 메일플러그 SMTP 호스트 (예: smtp.mailplug.co.kr)
 *   SMTP_PORT             — SMTP 포트 (예: 587)
 *   SMTP_USER             — 발신 이메일 주소
 *   SMTP_PASS             — 이메일 비밀번호
 */

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// ── Supabase 클라이언트 ─────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Mailplug SMTP 발신자 ────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailplug.co.kr',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // 587 포트는 STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── 날짜 유틸 ──────────────────────────────────────────────────────
function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

function previousBusinessDay(dateStr) {
  // 출장 시작일의 전 영업일을 반환 (주말 건너뜀)
  const d = new Date(dateStr + 'T12:00:00Z');
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().split('T')[0];
}

function formatKoreanDate(dateStr) {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  }).format(new Date(dateStr + 'T12:00:00Z'));
}

// ── 중복 발송 방지 ─────────────────────────────────────────────────
async function alreadySent(eventId, email) {
  const { data } = await supabase
    .from('imec_email_log')
    .select('id')
    .eq('event_id', String(eventId))
    .eq('recipient_email', email)
    .limit(1);
  return !!(data && data.length > 0);
}

async function logSent(eventId, email) {
  await supabase.from('imec_email_log').insert({
    event_id: String(eventId),
    recipient_email: email,
  });
}

// ── 이메일 템플릿 ──────────────────────────────────────────────────
const HEADER_STYLE = `
  font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  max-width: 560px; margin: 0 auto; color: #172122;
`;
const CELL_LABEL = `padding: 11px 0; border-bottom: 1px solid #f0f0f0; color: #697676; width: 72px; font-size: 14px; vertical-align: top;`;
const CELL_VALUE = `padding: 11px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px;`;

function tableRow(label, value) {
  if (!value) return '';
  return `<tr><td style="${CELL_LABEL}">${label}</td><td style="${CELL_VALUE}">${value}</td></tr>`;
}

function emailHeader(emoji, title, subtitle) {
  return `
  <div style="background: #164f46; color: white; padding: 26px 30px; border-radius: 14px 14px 0 0;">
    <p style="margin: 0; font-size: 11px; letter-spacing: 2px; opacity: .65; text-transform: uppercase;">IMEC People</p>
    <h2 style="margin: 8px 0 4px; font-size: 22px;">${emoji} ${title}</h2>
    <p style="margin: 0; font-size: 13px; opacity: .75;">${subtitle}</p>
  </div>`;
}

function emailFooter() {
  return `
  <div style="padding: 16px 30px; background: #f5f7f4; border-radius: 0 0 14px 14px; border: 1px solid #e5e9e7; border-top: 0;">
    <p style="margin: 0; font-size: 11px; color: #697676;">
      이 메일은 IMEC People HR 시스템에서 자동 발송되었습니다.<br>
      문의: <a href="mailto:${process.env.SMTP_USER}" style="color: #164f46;">${process.env.SMTP_USER}</a>
    </p>
  </div>`;
}

// 1) 회의 템플릿
function meetingTemplate(event, recipientName) {
  const dateTime = `${formatKoreanDate(event.date)}${event.time ? ' ' + event.time : ''}`;
  return {
    subject: `[IMEC] 오늘 회의 안내 — ${event.title}`,
    html: `<div style="${HEADER_STYLE}">
      ${emailHeader('📋', '오늘 회의 안내', dateTime)}
      <div style="background: white; padding: 28px 30px; border: 1px solid #e5e9e7; border-top: 0;">
        <p style="margin: 0 0 20px; font-size: 15px;">
          <strong>${recipientName}</strong>님, 안녕하세요.<br>
          오늘 아래 회의가 예정되어 있습니다. 참고해 주세요.
        </p>
        <table style="width: 100%; border-collapse: collapse;">
          ${tableRow('제목', `<strong>${event.title}</strong>`)}
          ${tableRow('일시', dateTime)}
          ${tableRow('장소', event.location || '-')}
          ${tableRow('주관자', `${event.creator} (<a href="mailto:${event.creator_email}" style="color:#164f46">${event.creator_email}</a>)`)}
        </table>
      </div>
      ${emailFooter()}
    </div>`,
  };
}

// 2) 출장 템플릿
function tripTemplate(event, recipientName) {
  const startDate = formatKoreanDate(event.date);
  const endDate = event.end_date && event.end_date !== event.date
    ? formatKoreanDate(event.end_date) : null;
  const period = endDate ? `${startDate} ~ ${endDate}` : startDate;
  return {
    subject: `[IMEC] 내일 출장 안내 — ${event.title}`,
    html: `<div style="${HEADER_STYLE}">
      ${emailHeader('✈️', '내일 출장 안내', `${startDate} 출발`)}
      <div style="background: white; padding: 28px 30px; border: 1px solid #e5e9e7; border-top: 0;">
        <p style="margin: 0 0 20px; font-size: 15px;">
          <strong>${recipientName}</strong>님, 안녕하세요.<br>
          내일부터 아래 출장이 예정되어 있습니다. 준비에 참고해 주세요.
        </p>
        <table style="width: 100%; border-collapse: collapse;">
          ${tableRow('제목', `<strong>${event.title}</strong>`)}
          ${tableRow('출장 기간', period)}
          ${tableRow('목적지', event.location || '-')}
          ${event.companions ? tableRow('동행자', event.companions) : ''}
          ${tableRow('주관자', `${event.creator} (<a href="mailto:${event.creator_email}" style="color:#164f46">${event.creator_email}</a>)`)}
        </table>
      </div>
      ${emailFooter()}
    </div>`,
  };
}

// 3) 기타 이벤트 템플릿
function otherTemplate(event, recipientName) {
  const dateTime = `${formatKoreanDate(event.date)}${event.time ? ' ' + event.time : ''}`;
  return {
    subject: `[IMEC] 오늘 일정 안내 — ${event.title}`,
    html: `<div style="${HEADER_STYLE}">
      ${emailHeader('📅', '오늘 일정 안내', dateTime)}
      <div style="background: white; padding: 28px 30px; border: 1px solid #e5e9e7; border-top: 0;">
        <p style="margin: 0 0 20px; font-size: 15px;">
          <strong>${recipientName}</strong>님, 안녕하세요.<br>
          오늘 아래 일정이 예정되어 있습니다. 참고해 주세요.
        </p>
        <table style="width: 100%; border-collapse: collapse;">
          ${tableRow('제목', `<strong>${event.title}</strong>`)}
          ${tableRow('일시', dateTime)}
          ${event.location ? tableRow('장소', event.location) : ''}
          ${tableRow('주관자', `${event.creator} (<a href="mailto:${event.creator_email}" style="color:#164f46">${event.creator_email}</a>)`)}
        </table>
      </div>
      ${emailFooter()}
    </div>`,
  };
}

const TEMPLATES = { meeting: meetingTemplate, trip: tripTemplate, other: otherTemplate };

// ── 메인 실행 ──────────────────────────────────────────────────────
async function main() {
  const today = todayKST();
  console.log(`[IMEC Email Cron] KST 날짜: ${today}`);

  const { data: events, error } = await supabase
    .from('imec_events')
    .select('*')
    .not('attendees_json', 'is', null)
    .neq('attendees_json', '[]');

  if (error) {
    console.error('Supabase 조회 실패:', error);
    process.exit(1);
  }

  console.log(`이벤트 ${events.length}건 조회됨`);
  let totalSent = 0;

  for (const event of events) {
    // 오늘 발송해야 하는지 판단
    let shouldSend = false;
    if ((event.type === 'meeting' || event.type === 'other') && event.date === today) {
      shouldSend = true;
    } else if (event.type === 'trip') {
      const prevBiz = previousBusinessDay(event.date);
      if (prevBiz === today) shouldSend = true;
    }
    if (!shouldSend) continue;

    const attendees = JSON.parse(event.attendees_json || '[]');
    const templateFn = TEMPLATES[event.type];
    if (!templateFn || !attendees.length) continue;

    console.log(`→ [${event.type}] "${event.title}" (${event.date}) — 수신자 ${attendees.length}명`);

    for (const { name, email } of attendees) {
      if (await alreadySent(event.id, email)) {
        console.log(`  ⏭ 중복 건너뜀: ${email}`);
        continue;
      }
      const mailOptions = templateFn(event, name);
      try {
        await transporter.sendMail({
          from: `"IMEC People" <${process.env.SMTP_USER}>`,
          to: email,
          ...mailOptions,
        });
        await logSent(event.id, email);
        console.log(`  ✓ 발송: ${email}`);
        totalSent++;
      } catch (err) {
        console.error(`  ✗ 발송 실패 ${email}:`, err.message);
      }
    }
  }

  console.log(`\n완료. 총 ${totalSent}건 발송.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
