'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ModuleCard = {
  id: string;
  label: string;
  icon: string;
  description: string;
  highlights: string[];
};

type PlanCard = {
  id: string;
  name: string;
  fit: string;
  bullets: string[];
  cta: string;
};

type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

type CarouselCard = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
};

type SafeIllustrationProps = {
  src: string;
  fallbackSrc: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
};

type ProblemSolution = {
  id: string;
  pain: string;
  impact: string;
  solution: string;
};

const modules: ModuleCard[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'DB',
    description: 'Executive operational snapshot for sales, stock, shift, and sync posture.',
    highlights: ['KPI cards', 'Branch/outlet code drill-down', 'Trend and risk signals']
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'RP',
    description: 'Formal reporting views with export and print-ready structure.',
    highlights: ['Date range filters', 'CSV exports', 'Cashier lane and barangay route scoping']
  },
  {
    id: 'products-pricing',
    label: 'Products and Pricing',
    icon: 'PP',
    description: 'Govern category, brand, LPG flow pricing, and product lifecycle.',
    highlights: ['Flow-aware prices', 'Category and brand controls', 'Pricing precedence']
  },
  {
    id: 'transfers-ops',
    label: 'Transfers and Operations',
    icon: 'TR',
    description: 'Control stock movement with validated source and destination logic.',
    highlights: ['Transfer lifecycle', 'Qty validation', 'Audit-compatible records']
  },
  {
    id: 'master-data',
    label: 'Master Data',
    icon: 'MD',
    description: 'Central setup for branch, outlet location, users, customers, suppliers, and roles.',
    highlights: ['Import wizard', 'Safe deactivate/reactivate', 'Code quality checks']
  },
  {
    id: 'tenancy-console',
    label: 'Tenancy Console',
    icon: 'TN',
    description: 'Owner-level governance over tenant lifecycle and entitlement policies.',
    highlights: ['Provisioning controls', 'Suspend/reactivate', 'Entitlement visibility']
  }
];

const outcomes = [
  { label: 'Unified Control', value: 'One workspace', detail: 'Sales, stock, transfer, reporting, and tenant controls' },
  { label: 'Branch + Outlet Visibility', value: 'Real-time', detail: 'Branch and outlet view of movements, risks, and operational status' },
  { label: 'Posting Confidence', value: 'Server-authoritative', detail: 'Audit-ready records with centralized posting logic' },
  { label: 'Faster Onboarding', value: 'Guided workflows', detail: 'Structured setup from tenant to branch and outlet operations' }
] as const;

const trustStrip = [
  { title: 'PH branch-outlet flows', detail: 'LPG-first operations structure' },
  { title: 'Sync confidence', detail: 'Offline queue with controlled posting' },
  { title: 'Audit-ready actions', detail: 'Traceable operational history' },
  { title: 'Owner governance', detail: 'Tenant visibility with branch/outlet code controls' },
  { title: 'Peso-based estimates', detail: 'PHP-focused ROI and operating visibility' }
] as const;

const problemSolutions: ProblemSolution[] = [
  {
    id: 'stock-mismatch',
    pain: 'Stock mismatches between branch, outlet, and warehouse',
    impact: 'Manual reconciliation delays daily operations.',
    solution: 'VPOS adds controlled transfer flows with clearer movement context, branch/outlet code tracking, and reporting traceability.'
  },
  {
    id: 'pricing-confusion',
    pain: 'Refill and non-refill pricing confusion at POS',
    impact: 'Cashier errors and inconsistent billing reduce trust.',
    solution: 'Flow-aware price rules reduce ambiguity and enforce consistent pricing behavior per cashier lane.'
  },
  {
    id: 'slow-closing',
    pain: 'Slow shift close and unclear cash posture',
    impact: 'End-of-day review takes too long and creates stress.',
    solution: 'Unified dashboard and reports reduce time to check sales, stock, delivery rider activity, and barangay route status.'
  }
];

const differentiators = [
  {
    title: 'Built for LPG operations, not generic retail',
    detail:
      'Flow-aware pricing, refill and non-refill handling, and stock movement discipline are already part of the product design.'
  },
  {
    title: 'From owner strategy to cashier execution',
    detail:
      'Web and mobile are designed as one operating model so policy, pricing, and reports map directly to branch and outlet execution, including cashier lane operations.'
  },
  {
    title: 'Operational accountability built in',
    detail:
      'Audit-ready actions, sync review patterns, and branch/outlet traceability are integrated to reduce blind spots.'
  }
] as const;

const plans: PlanCard[] = [
  {
    id: 'store',
    name: 'Store Only',
    fit: 'Single-branch LPG store operations (PH)',
    bullets: ['Sales, customers, products, and pricing', 'Opening stock and daily inventory control', 'Reports and branch/outlet code visibility'],
    cta: 'Start Store Setup'
  },
  {
    id: 'store-wh',
    name: 'Store + Warehouse',
    fit: 'Store + central stock operations',
    bullets: ['Warehouse transfer workflows', 'Store-warehouse movement controls', 'Stock and movement analytics'],
    cta: 'Plan Store + Warehouse'
  },
  {
    id: 'enterprise',
    name: 'Multi-Branch Enterprise',
    fit: 'Multi-branch tenants and governance (PH rollout)',
    bullets: ['Tenant lifecycle governance', 'Role-based access and audit trails', 'Scalable reports and control surface'],
    cta: 'Request Enterprise Demo'
  }
];

const onboardingSteps = [
  { step: '01', title: 'Tenant and Plan Setup', detail: 'Create tenant, map subscription, and enable branch and outlet scope with code setup.' },
  { step: '02', title: 'Master Data and Pricing', detail: 'Configure products, categories, cylinder data, and price rules.' },
  { step: '03', title: 'Branch/Outlet Go-Live', detail: 'Assign users, sync branch and outlet data, and activate mobile cashier lane execution.' },
  { step: '04', title: 'Monitor and Optimize', detail: 'Track KPIs, stock risk, delivery rider activity, and barangay route performance.' }
] as const;

const faqs: FaqItem[] = [
  {
    id: 'offline',
    question: 'Does it support offline branch and outlet execution?',
    answer:
      'Yes. Mobile supports offline-first workflows with queued sync so branch and outlet operations can continue even with unstable connection in PH deployments.'
  },
  {
    id: 'delivery',
    question: 'Can we track delivery rider and barangay route activity?',
    answer:
      'Yes. Operations and reporting flows can be aligned to delivery rider assignments and barangay route context for daily execution visibility.'
  },
  {
    id: 'pricing',
    question: 'Can refill and non-refill pricing be separated?',
    answer:
      'Yes. Pricing supports LPG flow-aware logic so REFILL and NON_REFILL can have distinct pricing and resolution precedence.'
  },
  {
    id: 'audit',
    question: 'How do we keep operations traceable?',
    answer:
      'The platform keeps action-level records, branch-scoped logs, and review queues for exceptional sync/posting events.'
  }
];

const mockups = [
  {
    id: 'dashboard',
    title: 'Executive Dashboard Mockup',
    subtitle: 'Sales + Margin + Stock risk posture',
    image: '/illustrations/mockup-dashboard.svg'
  },
  {
    id: 'reports',
    title: 'Reports Workspace Mockup',
    subtitle: 'Focused reporting with export controls',
    image: '/illustrations/mockup-reports.svg'
  },
  {
    id: 'mobile',
    title: 'Mobile POS Mockup',
    subtitle: 'Branch and outlet execution with guided cashier flow',
    image: '/illustrations/mockup-mobile-pos.svg'
  }
] as const;

const lpgCarousel: CarouselCard[] = [
  {
    id: 'cylinder',
    title: 'Cylinder Capacity View',
    subtitle: '5kg, 11kg, 22kg, and 50kg distribution in one glance',
    image: '/illustrations/lpg-carousel-cylinder.svg'
  },
  {
    id: 'supply',
    title: 'Isometric Supply Chain',
    subtitle: 'Supplier to warehouse to branch or outlet mapped as visual flow',
    image: '/illustrations/lpg-carousel-supply.svg'
  },
  {
    id: 'dispatch',
    title: 'Dispatch Readiness',
    subtitle: 'Delivery rider and barangay route posture for refill, non-refill, and empty returns',
    image: '/illustrations/lpg-carousel-dispatch.svg'
  }
];

function SafeIllustration({
  src,
  fallbackSrc,
  alt,
  width,
  height,
  className,
  priority
}: SafeIllustrationProps): JSX.Element {
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <Image
      src={currentSrc}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      unoptimized
      onError={() => {
        if (currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
        }
      }}
    />
  );
}

export function HomeLandingShowcase(): JSX.Element {
  const [activeModuleId, setActiveModuleId] = useState<string>(modules[0].id);
  const [activeFaqId, setActiveFaqId] = useState<string>(faqs[0].id);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dailySalesCount, setDailySalesCount] = useState(120);
  const [minutesSavedPerSale, setMinutesSavedPerSale] = useState(1.5);
  const [staffHourlyRate, setStaffHourlyRate] = useState(8);
  const [monthlyStockLoss, setMonthlyStockLoss] = useState(400);
  const [lossReductionPct, setLossReductionPct] = useState(35);
  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) ?? modules[0],
    [activeModuleId],
  );
  const activeFaq = useMemo(() => faqs.find((item) => item.id === activeFaqId) ?? faqs[0], [activeFaqId]);
  const activeCarousel = lpgCarousel[carouselIndex] ?? lpgCarousel[0];
  const roi = useMemo(() => {
    const monthlyLaborHours = (dailySalesCount * minutesSavedPerSale * 30) / 60;
    const laborSavings = monthlyLaborHours * staffHourlyRate;
    const stockSavings = monthlyStockLoss * (lossReductionPct / 100);
    const monthlyTotal = laborSavings + stockSavings;
    return {
      monthlyLaborHours,
      laborSavings,
      stockSavings,
      monthlyTotal,
      annualTotal: monthlyTotal * 12
    };
  }, [dailySalesCount, lossReductionPct, minutesSavedPerSale, monthlyStockLoss, staffHourlyRate]);

  const rotateNext = useCallback(() => {
    setCarouselIndex((prev) => (prev + 1) % lpgCarousel.length);
  }, []);

  const rotatePrev = useCallback(() => {
    setCarouselIndex((prev) => (prev - 1 + lpgCarousel.length) % lpgCarousel.length);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      rotateNext();
    }, 5400);
    return () => window.clearInterval(timer);
  }, [rotateNext]);

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 0
      }),
    [],
  );

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-8 pb-24 md:px-8 md:pb-8 lg:px-10">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(2,2,2,0.97),rgba(28,22,12,0.92)_44%,rgba(7,7,7,0.97))]" />
        <div className="absolute left-0 top-0 h-full w-full bg-[radial-gradient(circle_at_15%_12%,rgba(240,200,111,0.15),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(182,138,61,0.14),transparent_32%),radial-gradient(circle_at_45%_95%,rgba(250,214,136,0.10),transparent_32%)]" />
      </div>

      <div className="mx-auto mb-4 flex max-w-7xl justify-end">
        <Link
          href="/login"
          className="rounded-xl border border-amber-300/45 bg-amber-300/15 px-5 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/25"
        >
          Login
        </Link>
      </div>

      <section className="mx-auto max-w-7xl rounded-3xl border border-slate-200/20 bg-white/5 p-6 shadow-2xl backdrop-blur-md md:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="VPOS logo"
                width={40}
                height={40}
                className="h-10 w-10 rounded-lg border border-amber-300/50 bg-black/30 object-cover p-1"
                priority
              />
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200/90">VMJAMTECH</p>
                <p className="text-sm font-bold text-amber-100">VPOS Platform</p>
              </div>
            </div>
            <p className="inline-flex rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-amber-200">
              Enterprise Operations Suite
            </p>
            <h1 className="mt-4 text-3xl font-black leading-tight text-white md:text-5xl">
              Premium LPG Operations Platform Ready for Real-World Scale
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-200 md:text-base">
              Sell with confidence using a platform tailored for Philippine LPG operations, combining branch and outlet execution,
              inventory discipline, and management visibility. VPOS helps teams run cleaner processes and make faster decisions.
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {outcomes.map((item) => (
                <article
                  key={item.label}
                  className="rounded-xl border border-amber-300/25 bg-white/10 p-3 transition-all duration-500 hover:-translate-y-1 hover:border-amber-300/50 hover:shadow-[0_0_28px_rgba(240,200,111,0.2)]"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/85">{item.label}</p>
                  <p className="mt-2 text-xl font-black text-white">{item.value}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-200">{item.detail}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/85">LPG-focused visuals</p>
            <article className="group relative overflow-hidden rounded-2xl border border-amber-300/25 bg-black/40 p-3 transition-all duration-500 hover:border-amber-300/55 hover:shadow-[0_0_35px_rgba(240,200,111,0.28)]">
              <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl transition-opacity duration-500 group-hover:opacity-90" />
              <div className="pointer-events-none absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-amber-400/15 blur-3xl transition-opacity duration-500 group-hover:opacity-90" />
              <div className="relative [perspective:1200px]">
                <div className="transition-transform duration-700 ease-out [transform:rotateX(9deg)_rotateY(-8deg)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_translateY(-2px)]">
                  <SafeIllustration
                    src="/illustrations/lpg-tank-fleet.svg"
                    fallbackSrc="/illustrations/landing-enterprise.svg"
                    alt="LPG tank inventory illustration"
                    width={560}
                    height={320}
                    className="h-auto w-full rounded-xl"
                    priority
                  />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-amber-300/35 bg-black/35 px-3 py-2 text-xs text-amber-100">
                  Full + Empty posture
                </div>
                <div className="rounded-lg border border-amber-300/35 bg-black/35 px-3 py-2 text-xs text-amber-100">
                  Flow-aware movement
                </div>
              </div>
            </article>
            <article className="group relative overflow-hidden rounded-2xl border border-amber-300/25 bg-black/35 p-3 transition-all duration-500 hover:border-amber-300/55 hover:shadow-[0_0_30px_rgba(240,200,111,0.22)]">
              <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-amber-300/18 blur-3xl transition-opacity duration-500 group-hover:opacity-90" />
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/85">Isometric supply-chain block</p>
              <SafeIllustration
                src="/illustrations/lpg-logistics-network.svg"
                fallbackSrc="/illustrations/landing-ops.svg"
                alt="LPG logistics network illustration"
                width={560}
                height={320}
                className="h-auto w-full rounded-xl transition-transform duration-700 ease-out group-hover:scale-[1.015]"
              />
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-4 max-w-7xl rounded-2xl border border-amber-300/25 bg-black/35 p-3 backdrop-blur-md">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {trustStrip.map((item) => (
            <article
              key={item.title}
              className="rounded-lg border border-amber-300/20 bg-white/5 px-3 py-2 transition hover:border-amber-300/40 hover:bg-amber-300/10"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">{item.title}</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-300">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-amber-300/25 bg-black/35 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">LPG Visual Carousel</h3>
            <p className="text-xs text-slate-300">Small rotating visuals built from custom on-brand assets. Swipe left or right on mobile.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous LPG visual"
              onClick={rotatePrev}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/45 text-amber-100 transition hover:bg-amber-300/15"
            >
              <span aria-hidden="true">&lt;</span>
            </button>
            {lpgCarousel.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Show ${item.title}`}
                onClick={() => setCarouselIndex(index)}
                className={`h-2.5 w-2.5 rounded-full transition ${
                  index === carouselIndex ? 'bg-amber-300 shadow-[0_0_10px_rgba(240,200,111,0.7)]' : 'bg-amber-300/35 hover:bg-amber-300/55'
                }`}
              />
            ))}
            <button
              type="button"
              aria-label="Next LPG visual"
              onClick={rotateNext}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/45 text-amber-100 transition hover:bg-amber-300/15"
            >
              <span aria-hidden="true">&gt;</span>
            </button>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article
            className="group relative overflow-hidden rounded-2xl border border-amber-300/30 bg-white/5 p-3 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_0_36px_rgba(240,200,111,0.24)]"
            onTouchStart={(event) => setTouchStartX(event.changedTouches[0]?.clientX ?? null)}
            onTouchEnd={(event) => {
              if (touchStartX === null) {
                return;
              }
              const endX = event.changedTouches[0]?.clientX ?? touchStartX;
              const delta = endX - touchStartX;
              if (Math.abs(delta) > 42) {
                if (delta < 0) {
                  rotateNext();
                } else {
                  rotatePrev();
                }
              }
              setTouchStartX(null);
            }}
          >
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />
            <SafeIllustration
              key={activeCarousel.id}
              src={activeCarousel.image}
              fallbackSrc="/illustrations/lpg-carousel-cylinder.svg"
              alt={activeCarousel.title}
              width={860}
              height={460}
              className="lpg-carousel-slide h-auto w-full rounded-xl"
            />
          </article>
          <aside className="rounded-2xl border border-amber-300/30 bg-black/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">Current visual</p>
            <h4 className="mt-2 text-xl font-bold text-white">{activeCarousel.title}</h4>
            <p className="mt-2 text-sm text-slate-200">{activeCarousel.subtitle}</p>
            <div className="mt-4 space-y-2">
              <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                Black and gold glow accents
              </div>
              <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                Faux 3D depth and smooth hover motion
              </div>
              <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                LPG domain visuals, no stock assets used
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-amber-300/25 bg-black/35 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Problem to Solution Mapping</h3>
          <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            Buyer-friendly narrative
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {problemSolutions.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-amber-300/25 bg-white/5 p-4 transition-all duration-500 hover:-translate-y-1 hover:border-amber-300/55 hover:shadow-[0_0_26px_rgba(240,200,111,0.2)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-200">Pain Point</p>
              <h4 className="mt-2 text-sm font-bold text-white">{item.pain}</h4>
              <p className="mt-2 text-xs text-slate-300">{item.impact}</p>
              <p className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                {item.solution}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-amber-300/25 bg-black/35 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">ROI Estimator</h3>
          <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            Sales conversation tool
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <div className="space-y-3 rounded-2xl border border-amber-300/25 bg-white/5 p-4">
            <label className="block text-xs text-slate-200">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-amber-200">Daily Transactions per Cashier Lane (Branch/Outlet)</span>
              <input
                className="w-full accent-amber-300"
                max={1200}
                min={10}
                onChange={(event) => setDailySalesCount(Number(event.target.value))}
                type="range"
                value={dailySalesCount}
              />
              <span className="text-amber-100">{dailySalesCount} transactions/day per cashier lane</span>
            </label>

            <label className="block text-xs text-slate-200">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-amber-200">Minutes Saved Per Sale</span>
              <input
                className="w-full accent-amber-300"
                max={5}
                min={0.2}
                onChange={(event) => setMinutesSavedPerSale(Number(event.target.value))}
                step={0.1}
                type="range"
                value={minutesSavedPerSale}
              />
              <span className="text-amber-100">{minutesSavedPerSale.toFixed(1)} min/sale</span>
            </label>

            <label className="block text-xs text-slate-200">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-amber-200">Staff Hourly Rate (PHP)</span>
              <input
                className="w-full accent-amber-300"
                max={40}
                min={3}
                onChange={(event) => setStaffHourlyRate(Number(event.target.value))}
                step={0.5}
                type="range"
                value={staffHourlyRate}
              />
              <span className="text-amber-100">{currency.format(staffHourlyRate)}/hour</span>
            </label>

            <label className="block text-xs text-slate-200">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-amber-200">30-Day Stock Leakage Estimate (PHP)</span>
              <input
                className="w-full accent-amber-300"
                max={4000}
                min={100}
                onChange={(event) => setMonthlyStockLoss(Number(event.target.value))}
                step={50}
                type="range"
                value={monthlyStockLoss}
              />
              <span className="text-amber-100">{currency.format(monthlyStockLoss)}/30-day cycle</span>
            </label>

            <label className="block text-xs text-slate-200">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-amber-200">Expected Leakage Reduction</span>
              <input
                className="w-full accent-amber-300"
                max={90}
                min={10}
                onChange={(event) => setLossReductionPct(Number(event.target.value))}
                step={1}
                type="range"
                value={lossReductionPct}
              />
              <span className="text-amber-100">{lossReductionPct}% reduction</span>
            </label>
          </div>

          <aside className="rounded-2xl border border-amber-300/25 bg-black/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Estimated Returns</p>
            <div className="mt-3 grid gap-2">
              <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-amber-100">30-Day Labor Savings</p>
                <p className="text-lg font-bold text-white">{currency.format(roi.laborSavings)}</p>
                <p className="text-[11px] text-slate-300">{roi.monthlyLaborHours.toFixed(1)} hours reclaimed/30-day cycle</p>
              </div>
              <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-amber-100">30-Day Stock Savings</p>
                <p className="text-lg font-bold text-white">{currency.format(roi.stockSavings)}</p>
                <p className="text-[11px] text-slate-300">From tighter movement controls</p>
              </div>
              <div className="rounded-lg border border-amber-300/35 bg-amber-300/15 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-amber-100">Total 30-Day Impact</p>
                <p className="text-xl font-black text-white">{currency.format(roi.monthlyTotal)}</p>
              </div>
              <div className="rounded-lg border border-amber-300/45 bg-amber-300/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-amber-100">Projected Annual Impact</p>
                <p className="text-2xl font-black text-amber-100">{currency.format(roi.annualTotal)}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-slate-200/20 bg-white/5 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Why Teams Buy VPOS</h3>
          <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            Sales-ready positioning
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {differentiators.map((item) => (
            <article
              key={item.title}
              className="rounded-xl border border-amber-300/25 bg-black/40 p-4 transition-all duration-500 hover:-translate-y-1 hover:border-amber-300/50 hover:shadow-[0_0_24px_rgba(240,200,111,0.2)]"
            >
              <h4 className="text-sm font-bold text-amber-100">{item.title}</h4>
              <p className="mt-2 text-xs leading-5 text-slate-200">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-slate-200/20 bg-white/5 p-5 backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Quick Access Modules (Interactive Showcase)</h3>
          <span className="rounded-full border border-slate-300/30 bg-white/10 px-3 py-1 text-xs text-slate-200">
            Presentation mode only
          </span>
        </div>
        <p className="mb-4 text-sm text-slate-200">
          These cards are explainers for the product surface. They are intentionally non-navigation.
        </p>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {modules.map((module) => {
              const active = module.id === activeModule.id;
              return (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => setActiveModuleId(module.id)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? 'border-amber-300/60 bg-amber-300/15 shadow-[0_0_20px_rgba(240,200,111,0.22)]'
                      : 'border-slate-200/20 bg-white/10 hover:-translate-y-0.5 hover:border-amber-300/40 hover:bg-white/15'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-300/15 text-xs font-bold text-amber-200">
                      {module.icon}
                    </span>
                    <p className="text-sm font-bold text-slate-100">{module.label}</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-200">{module.description}</p>
                </button>
              );
            })}
          </div>

          <aside className="rounded-2xl border border-slate-200/20 bg-white/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Module Detail</p>
            <h4 className="mt-2 text-xl font-bold text-white">{activeModule.label}</h4>
            <p className="mt-2 text-sm text-slate-200">{activeModule.description}</p>
            <ul className="mt-4 space-y-2">
              {activeModule.highlights.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border border-slate-200/20 bg-slate-900/40 px-3 py-2 text-xs text-slate-100"
                >
                  {item}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-slate-200/20 bg-white/5 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Platform Mockups</h3>
          <span className="rounded-full border border-slate-300/30 bg-white/10 px-3 py-1 text-xs text-slate-200">
            Branded in-house visuals
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {mockups.map((mockup) => (
            <article key={mockup.id} className="rounded-2xl border border-slate-200/20 bg-white/10 p-3">
              <Image
                src={mockup.image}
                alt={mockup.title}
                width={520}
                height={360}
                className="h-auto w-full rounded-xl"
              />
              <h4 className="mt-3 text-sm font-bold text-white">{mockup.title}</h4>
              <p className="mt-1 text-xs text-slate-200">{mockup.subtitle}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="plans" className="mx-auto mt-7 max-w-7xl rounded-2xl border border-slate-200/20 bg-white/5 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Deployment Paths</h3>
          <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            Sell by business size
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-2xl border border-amber-300/25 bg-black/45 p-4">
              <h4 className="text-sm font-bold uppercase tracking-wide text-amber-100">{plan.name}</h4>
              <p className="mt-2 text-sm text-slate-100">{plan.fit}</p>
              <ul className="mt-3 space-y-2">
                {plan.bullets.map((bullet) => (
                  <li key={bullet} className="rounded-lg border border-slate-200/20 bg-white/5 px-3 py-2 text-xs text-slate-200">
                    {bullet}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-4 w-full rounded-lg border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 transition hover:bg-amber-300/25"
              >
                {plan.cta}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-7 max-w-7xl rounded-2xl border border-slate-200/20 bg-white/5 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Implementation Journey</h3>
          <span className="rounded-full border border-slate-300/30 bg-white/10 px-3 py-1 text-xs text-slate-200">
            Clear onboarding flow
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          {onboardingSteps.map((item) => (
            <article key={item.step} className="rounded-xl border border-amber-300/25 bg-black/35 p-3">
              <p className="text-xs font-black tracking-[0.2em] text-amber-300">{item.step}</p>
              <h4 className="mt-1 text-sm font-bold text-amber-100">{item.title}</h4>
              <p className="mt-2 text-xs leading-5 text-slate-200">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-7 mb-6 max-w-7xl rounded-2xl border border-slate-200/20 bg-white/5 p-5 backdrop-blur-md">
        <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <aside className="rounded-2xl border border-amber-300/25 bg-black/45 p-4">
            <h3 className="text-lg font-bold text-white">FAQ</h3>
            <p className="mt-1 text-xs text-slate-300">Focused answers for sales and onboarding conversations.</p>
            <div className="mt-3 space-y-2">
              {faqs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveFaqId(item.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                    item.id === activeFaq.id
                      ? 'border-amber-300/55 bg-amber-300/15 text-amber-100'
                      : 'border-slate-300/25 bg-white/5 text-slate-200 hover:border-amber-300/35'
                  }`}
                >
                  {item.question}
                </button>
              ))}
            </div>
          </aside>

          <article className="rounded-2xl border border-slate-200/20 bg-white/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Answer</p>
            <h4 className="mt-2 text-lg font-bold text-white">{activeFaq.question}</h4>
            <p className="mt-3 text-sm leading-6 text-slate-200">{activeFaq.answer}</p>

            <div className="mt-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
              <h5 className="text-sm font-bold text-amber-100">Ready to onboard your team?</h5>
              <p className="mt-1 text-xs text-slate-200">
                Use this page as your premium product overview, then continue to secure login for full access.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/login"
                  className="rounded-lg border border-amber-300/45 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 hover:bg-amber-300/15"
                >
                  Login
                </Link>
              </div>
            </div>
          </article>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-amber-300/30 bg-black/80 p-3 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <a
            href="#plans"
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-amber-300/35 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100"
          >
            View Plans
          </a>
          <Link
            href="/login"
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100"
          >
            Login
          </Link>
        </div>
      </div>
    </main>
  );
}
