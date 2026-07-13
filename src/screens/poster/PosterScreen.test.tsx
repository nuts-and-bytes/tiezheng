import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../../lib/db';
import { seedPresets } from '../../repos/exerciseRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { todayStr } from '../../lib/dates';
import { PosterScreen } from './PosterScreen';

/* ── 假 canvas ─────────────────────────────────────────────────────────
   jsdom 没有 2D canvas（没装 canvas / vitest-canvas-mock），getContext('2d')
   返回 null、toBlob 直接 notImplemented。所以这里塞一个会录音的 ctx，
   既能让屏幕跑起来，又能证明「note 一次都没被 fillText 出去」。 */

let drawn: string[] = [];

/** 和 poster.test.ts 同一个字宽模型：Anton 0.51em、拉丁 0.55em、全角 1em。
    字号无关的假宽度会让排版函数误判「放不下」，把 footer 那句截断掉。 */
const FULLWIDTH = /[⺀-鿿　-〿＀-￯]/u;

function fakeMeasure(s: string, font: string): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const anton = /Anton/i.test(font);
  let w = 0;
  for (const ch of s) w += size * (anton ? 0.51 : FULLWIDTH.test(ch) ? 1 : 0.55);
  return w;
}

function fakeCtx(): CanvasRenderingContext2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const ctx: Record<string, unknown> = {
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    setLineDash: noop,
    fillText: (s: string) => drawn.push(String(s)),
    measureText: (s: string) => ({ width: fakeMeasure(String(s), String(ctx.font)) }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    globalAlpha: 1,
    letterSpacing: '0px',
    shadowBlur: 0,
    shadowColor: '',
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

let toBlob: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDb();
  await seedPresets();
  drawn = [];

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeCtx() as unknown as RenderingContext,
  );
  toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['png'], { type: 'image/png' })));
  HTMLCanvasElement.prototype.toBlob = toBlob as unknown as HTMLCanvasElement['toBlob'];

  // jsdom 没有 createObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();

  anchorClick = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

// 参数打上 ShareData 类型：下面才能直接读出 share 收到的 files/title，不用 any
function enableShare(share = vi.fn((_data: ShareData) => Promise.resolve())) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'canShare', {
    value: () => true,
    configurable: true,
    writable: true,
  });
  return share;
}

const YM = todayStr().slice(0, 7);
const d = (day: string) => `${YM}-${day}`;
const setsOf = (n: number) => Array.from({ length: n }, () => ({ weight: 60, reps: 8 }));

async function seed() {
  await addWorkoutItem(d('03'), 'p-bench', setsOf(4));
  await addWorkoutItem(d('04'), 'p-pullup', setsOf(3));
  await addWorkoutItem(d('05'), 'p-squat', setsOf(5));
}

function renderPoster() {
  return render(
    <MemoryRouter>
      <PosterScreen />
    </MemoryRouter>,
  );
}

/** 海报画完 + blob 备好，才算准备就绪 */
async function waitReady() {
  await waitFor(() => expect(toBlob).toHaveBeenCalled());
  await waitFor(() => expect(exportBtn()).toBeEnabled());
}

const exportBtn = () => screen.getByRole('button', { name: /分享|下载/ });

describe('预览', () => {
  test('默认月度：画布画出当月海报', async () => {
    await seed();
    renderPoster();
    await waitReady();

    expect(screen.getByRole('img', { name: /海报/ })).toBeInTheDocument();
    expect(drawn).toContain('铁证 IRONPROOF');
    expect(drawn).toContain('MONTHLY PROOF');
    expect(drawn).toContain('3'); // 3 个训练日
    expect(drawn).toContain('天 · 盖下钢印');
  });

  test('切到年度：画年度海报', async () => {
    await seed();
    const user = userEvent.setup();
    renderPoster();
    await waitReady();

    drawn = [];
    await user.click(screen.getByRole('button', { name: '年度' }));

    await waitFor(() => expect(drawn).toContain('YEARLY PROOF'));
    expect(drawn).toContain(String(new Date().getFullYear()));
  });

  /** 分享出去的图是标准件：月度、年度、任何月份，都得是同一张 9:16 的 1080×1920。
      之前高度跟着内容走（3 月 1170×2853、7 月 1170×2715），社交平台裁得乱七八糟。 */
  test('导出画布恒为 1080×1920（9:16），和内容多少无关', async () => {
    await seed();
    const user = userEvent.setup();
    renderPoster();
    await waitReady();

    const canvas = screen.getByRole('img', { name: /海报/ }) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    expect(canvas.width / canvas.height).toBeCloseTo(9 / 16, 10);

    await user.click(screen.getByRole('button', { name: '年度' }));
    await waitFor(() => expect(drawn).toContain('YEARLY PROOF'));
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
  });

  /** 导出的位图是 9:16 了，但**屏幕上看到的**也得是 9:16——用户是照着预览决定要不要分享的。
      canvas 是 replaced element，放进 flex 行里会吃 align-items:stretch，交叉轴被拉满整行高，
      固有比例（width/height 属性）拦不住。一旦 max-w 先于 max-h 触底（平板 1024×1366 实测
      280×710，比 9:16 长了 30%），预览就是变形的。align-self:center 让它退回按比例缩放。

      jsdom 没有排版引擎，量不出这个（改坏了 49 个测试照样全绿——它就是这么溜过去的）。
      所以这里退而求其次锁 class：把不变量钉在 canvas 自己身上，父容器怎么改都带得走。 */
  test('预览画布不被 flex 拉伸（self-center 是承重的，不是装饰）', async () => {
    await seed();
    renderPoster();
    await waitReady();

    const canvas = screen.getByRole('img', { name: /海报/ });
    expect(canvas).toHaveClass('self-center');
    // 宽高都得是 auto + 上限，任何一边写死都会毁掉固有比例
    expect(canvas).toHaveClass('h-auto', 'w-auto');
  });

  test('footer 那句隐私承诺整句都在（排版让位靠降级，不靠截断）', async () => {
    await seed();
    renderPoster();
    await waitReady();
    expect(drawn).toContain('TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传');
  });

  test('一次铁证都没有：给空态，不给一张空海报', async () => {
    renderPoster();
    await screen.findByText(/还没有/);
    expect(screen.queryByRole('button', { name: /分享|下载/ })).not.toBeInTheDocument();
  });

  test('有返回口（/poster 在 TabLayout 之外，没有底栏）', async () => {
    await seed();
    renderPoster();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
  });

  test('把「照片不上传」写在用户看得见的地方', async () => {
    await seed();
    renderPoster();
    expect(await screen.findByText(/照片不上传/)).toBeInTheDocument();
  });
});

describe('导出', () => {
  /** iOS transient activation：blob 必须在点击**之前**就备好，
      否则 onClick 里 await toBlob 再 share，授权已失效 → NotAllowedError。 */
  test('blob 在用户点之前就备好了', async () => {
    await seed();
    renderPoster();

    await waitFor(() => expect(toBlob).toHaveBeenCalled());
    // 还没点任何东西，blob 已经在手上
    expect(exportBtn()).toBeEnabled();
  });

  test('点击时同步调用 share —— 中间一个 await 都没有', async () => {
    const share = enableShare();
    await seed();
    renderPoster();
    await waitReady();

    // fireEvent 是同步的：click 返回时 share 必须已经被调用过。
    // 如果实现里 await 了 toBlob / 任何 Promise，这里就会是 0 次。
    fireEvent.click(exportBtn());
    expect(share).toHaveBeenCalledTimes(1);

    const data = share.mock.calls[0]![0];
    expect(data.files).toHaveLength(1);
    expect(data.files![0]).toBeInstanceOf(File);
    expect(data.files![0]!.type).toBe('image/png');
    expect(data.files![0]!.name).toMatch(/^ironproof-\d{4}-\d{2}\.png$/);
    expect(data.title).toContain('铁证');
  });

  test('不支持分享时降级为下载', async () => {
    // 没有 navigator.share
    await seed();
    renderPoster();
    await waitReady();

    fireEvent.click(exportBtn());

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  test('年度海报的文件名是年份', async () => {
    const share = enableShare();
    await seed();
    const user = userEvent.setup();
    renderPoster();
    await waitReady();

    await user.click(screen.getByRole('button', { name: '年度' }));
    await waitFor(() => expect(drawn).toContain('YEARLY PROOF'));
    await waitFor(() => expect(exportBtn()).toBeEnabled());

    fireEvent.click(exportBtn());
    const data = share.mock.calls[0]![0];
    expect(data.files![0]!.name).toMatch(/^ironproof-\d{4}\.png$/);
  });
});

/* ── 产品铁律 7 ────────────────────────────────────────────────────────── */
describe('隐私：note 绝不上海报', () => {
  const NOTE = '今天心情很烂，跟同事吵了一架';

  test('训练日志里的私人备注，既不进 DOM，也不进 canvas', async () => {
    await seed();
    // 真·数据库里存一条带 note 的训练
    await db.workouts.where('date').equals(d('03')).modify({ note: NOTE });
    expect((await db.workouts.where('date').equals(d('03')).first())?.note).toBe(NOTE);

    renderPoster();
    await waitReady();

    expect(document.body.textContent ?? '').not.toContain('心情');
    expect(document.body.textContent ?? '').not.toContain('同事');
    for (const s of drawn) {
      expect(s).not.toContain('心情');
      expect(s).not.toContain('同事');
    }
  });

  test('海报全程零网络请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await seed();
    renderPoster();
    await waitReady();
    fireEvent.click(exportBtn());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Anton 是内联的**数字子集**——实测字形范围 U+0020–U+007E，95 个 ASCII，零 CJK。
 * 把中文塞进 `.display`，那个字会掉进后备字体：紧挨着一个压缩重体的「7」，
 * 冒出一个常规字重的「月」，字宽、字重、基线全对不上，视觉上直接裂开。
 *
 * 这不是一个 bug，是一条全站不变量：**`.display` 里只能有 ASCII。**
 * 全站的写法本来就是「数字上 Anton，单位用正文字体」（`{n} 组`、`{kg} kg`），
 * 海报页的月份 chip 是唯一一处违例。
 */
test('.display 元素里不许出现中文（Anton 没有 CJK 字形）', async () => {
  await seed();
  renderPoster();
  await waitReady();

  const cjk = /[一-鿿]/;
  const offenders = [...document.querySelectorAll('.display')]
    .map((el) => el.textContent ?? '')
    .filter((t) => cjk.test(t));

  expect(offenders).toEqual([]);
});
