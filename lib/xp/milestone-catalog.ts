/**

 * Engagement milestones: keys are stable; XP amounts are server-trusted constants.

 * Eligibility is evaluated on dashboard load and missing rows are inserted idempotently.

 *

 * Milestone XP totals are sized so a wallet that completes every milestone reaches

 * level 100 (see `level-from-xp` MAX_LEVEL and the per-level XP curve).

 */

export type MilestoneSnapshot = {
  /** True when display name is set and not the auto-generated wallet abbreviation. */

  customDisplayName: boolean;

  discordLinked: boolean;

  /** Distinct raffles with at least one confirmed entry. */

  uniqueConfirmedRaffleCount: number;

  /** Sum of ticket_quantity across confirmed entry rows. */

  confirmedTicketQuantitySum: number;

  /** Raffles created by this wallet (any status returned by creator query). */

  hostedRaffleCount: number;
};

export type EngagementMilestoneDef = {
  key: string;

  xp: number;

  title: string;

  description: string;

  when: (s: MilestoneSnapshot) => boolean;
};

export const ENGAGEMENT_MILESTONES: readonly EngagementMilestoneDef[] = [
  {
    key: "profile_display_name",

    xp: 25,

    title: "Display name",

    description: "Set a custom name (not the auto wallet label).",

    when: (s) => s.customDisplayName,
  },

  {
    key: "profile_discord",

    xp: 40,

    title: "Discord linked",

    description: "Connect Discord from your Wallet tab.",

    when: (s) => s.discordLinked,
  },

  {
    key: "entrant_unique_raffles_1",

    xp: 35,

    title: "First raffle entered",

    description: "At least one confirmed ticket on any raffle.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 1,
  },

  {
    key: "entrant_unique_raffles_5",

    xp: 30,

    title: "5 raffles",

    description: "Confirmed entries on 5 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 5,
  },

  {
    key: "entrant_unique_raffles_10",

    xp: 50,

    title: "10 raffles",

    description: "Confirmed entries on 10 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 10,
  },

  {
    key: "entrant_unique_raffles_25",

    xp: 100,

    title: "25 raffles",

    description: "Confirmed entries on 25 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 25,
  },

  {
    key: "entrant_unique_raffles_50",

    xp: 100,

    title: "50 raffles",

    description: "Confirmed entries on 50 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 50,
  },

  {
    key: "entrant_unique_raffles_75",

    xp: 115,

    title: "75 raffles",

    description: "Confirmed entries on 75 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 75,
  },

  {
    key: "entrant_unique_raffles_100",

    xp: 130,

    title: "100 raffles",

    description: "Confirmed entries on 100 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 100,
  },

  {
    key: "entrant_unique_raffles_150",

    xp: 170,

    title: "150 raffles",

    description: "Confirmed entries on 150 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 150,
  },

  {
    key: "entrant_unique_raffles_200",

    xp: 220,

    title: "200 raffles",

    description: "Confirmed entries on 200 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 200,
  },

  {
    key: "entrant_unique_raffles_300",

    xp: 310,

    title: "300 raffles",

    description: "Confirmed entries on 300 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 300,
  },

  {
    key: "entrant_unique_raffles_400",

    xp: 400,

    title: "400 raffles",

    description: "Confirmed entries on 400 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 400,
  },

  {
    key: "entrant_unique_raffles_500",

    xp: 500,

    title: "500 raffles",

    description: "Confirmed entries on 500 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 500,
  },

  {
    key: "entrant_unique_raffles_650",

    xp: 620,

    title: "650 raffles",

    description: "Confirmed entries on 650 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 650,
  },

  {
    key: "entrant_unique_raffles_800",

    xp: 760,

    title: "800 raffles",

    description: "Confirmed entries on 800 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 800,
  },

  {
    key: "entrant_unique_raffles_1000",

    xp: 940,

    title: "1,000 raffles",

    description: "Confirmed entries on 1,000 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 1000,
  },

  {
    key: "entrant_unique_raffles_1250",

    xp: 1120,

    title: "1,250 raffles",

    description: "Confirmed entries on 1,250 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 1250,
  },

  {
    key: "entrant_unique_raffles_1500",

    xp: 1300,

    title: "1,500 raffles",

    description: "Confirmed entries on 1,500 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 1500,
  },

  {
    key: "entrant_unique_raffles_2000",

    xp: 1680,

    title: "2,000 raffles",

    description: "Confirmed entries on 2,000 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 2000,
  },

  {
    key: "entrant_unique_raffles_2500",

    xp: 2050,

    title: "2,500 raffles",

    description: "Confirmed entries on 2,500 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 2500,
  },

  {
    key: "entrant_unique_raffles_3000",

    xp: 2400,

    title: "3,000 raffles",

    description: "Confirmed entries on 3,000 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 3000,
  },

  {
    key: "entrant_unique_raffles_5000",

    xp: 3565,

    title: "5,000 raffles",

    description: "Confirmed entries on 5,000 different raffles.",

    when: (s) => s.uniqueConfirmedRaffleCount >= 5000,
  },

  {
    key: "entrant_tickets_25",

    xp: 20,

    title: "25 tickets",

    description: "At least 25 confirmed tickets total (any raffles).",

    when: (s) => s.confirmedTicketQuantitySum >= 25,
  },

  {
    key: "entrant_tickets_100",

    xp: 40,

    title: "100 tickets",

    description: "At least 100 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 100,
  },

  {
    key: "entrant_tickets_500",

    xp: 80,

    title: "500 tickets",

    description: "At least 500 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 500,
  },

  {
    key: "entrant_tickets_1000",

    xp: 90,

    title: "1,000 tickets",

    description: "At least 1,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 1000,
  },

  {
    key: "entrant_tickets_2500",

    xp: 130,

    title: "2,500 tickets",

    description: "At least 2,500 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 2500,
  },

  {
    key: "entrant_tickets_5000",

    xp: 180,

    title: "5,000 tickets",

    description: "At least 5,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 5000,
  },

  {
    key: "entrant_tickets_7500",

    xp: 260,

    title: "7,500 tickets",

    description: "At least 7,500 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 7500,
  },

  {
    key: "entrant_tickets_10000",

    xp: 400,

    title: "10,000 tickets",

    description: "At least 10,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 10000,
  },

  {
    key: "entrant_tickets_25000",

    xp: 580,

    title: "25,000 tickets",

    description: "At least 25,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 25000,
  },

  {
    key: "entrant_tickets_50000",

    xp: 800,

    title: "50,000 tickets",

    description: "At least 50,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 50000,
  },

  {
    key: "entrant_tickets_100000",

    xp: 1150,

    title: "100,000 tickets",

    description: "At least 100,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 100000,
  },

  {
    key: "entrant_tickets_250000",

    xp: 1550,

    title: "250,000 tickets",

    description: "At least 250,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 250000,
  },

  {
    key: "entrant_tickets_500000",

    xp: 1850,

    title: "500,000 tickets",

    description: "At least 500,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 500000,
  },

  {
    key: "entrant_tickets_750000",

    xp: 2150,

    title: "750,000 tickets",

    description: "At least 750,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 750000,
  },

  {
    key: "entrant_tickets_1000000",

    xp: 2800,

    title: "1,000,000 tickets",

    description: "At least 1,000,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 1000000,
  },

  {
    key: "entrant_tickets_1500000",

    xp: 3800,

    title: "1,500,000 tickets",

    description: "At least 1,500,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 1500000,
  },

  {
    key: "entrant_tickets_2500000",

    xp: 5000,

    title: "2,500,000 tickets",

    description: "At least 2,500,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 2500000,
  },

  {
    key: "entrant_tickets_4000000",

    xp: 5000,

    title: "4,000,000 tickets",

    description: "At least 4,000,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 4000000,
  },

  {
    key: "entrant_tickets_6000000",

    xp: 6500,

    title: "6,000,000 tickets",

    description: "At least 6,000,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 6000000,
  },

  {
    key: "entrant_tickets_10000000",

    xp: 4000,

    title: "10,000,000 tickets",

    description: "At least 10,000,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 10000000,
  },

  {
    key: "entrant_tickets_15000000",

    xp: 4500,

    title: "15,000,000 tickets",

    description: "At least 15,000,000 confirmed tickets total.",

    when: (s) => s.confirmedTicketQuantitySum >= 15000000,
  },

  {
    key: "host_raffles_1",

    xp: 45,

    title: "First host listing",

    description: "Create your first raffle as host.",

    when: (s) => s.hostedRaffleCount >= 1,
  },

  {
    key: "host_raffles_5",

    xp: 50,

    title: "5 host listings",

    description: "Five raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 5,
  },

  {
    key: "host_raffles_10",

    xp: 50,

    title: "10 host listings",

    description: "Ten raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 10,
  },

  {
    key: "host_raffles_15",

    xp: 60,

    title: "15 host listings",

    description: "Fifteen raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 15,
  },

  {
    key: "host_raffles_20",

    xp: 70,

    title: "20 host listings",

    description: "Twenty raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 20,
  },

  {
    key: "host_raffles_25",

    xp: 80,

    title: "25 host listings",

    description: "Twenty-five raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 25,
  },

  {
    key: "host_raffles_35",

    xp: 100,

    title: "35 host listings",

    description: "Thirty-five raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 35,
  },

  {
    key: "host_raffles_50",

    xp: 130,

    title: "50 host listings",

    description: "Fifty raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 50,
  },

  {
    key: "host_raffles_75",

    xp: 170,

    title: "75 host listings",

    description: "Seventy-five raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 75,
  },

  {
    key: "host_raffles_100",

    xp: 220,

    title: "100 host listings",

    description: "One hundred raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 100,
  },

  {
    key: "host_raffles_150",

    xp: 320,

    title: "150 host listings",

    description: "One hundred fifty raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 150,
  },

  {
    key: "host_raffles_200",

    xp: 420,

    title: "200 host listings",

    description: "Two hundred raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 200,
  },

  {
    key: "host_raffles_300",

    xp: 600,

    title: "300 host listings",

    description: "Three hundred raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 300,
  },

  {
    key: "host_raffles_400",

    xp: 780,

    title: "400 host listings",

    description: "Four hundred raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 400,
  },

  {
    key: "host_raffles_500",

    xp: 960,

    title: "500 host listings",

    description: "Five hundred raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 500,
  },

  {
    key: "host_raffles_750",

    xp: 1400,

    title: "750 host listings",

    description: "Seven hundred fifty raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 750,
  },

  {
    key: "host_raffles_1000",

    xp: 1850,

    title: "1,000 host listings",

    description: "One thousand raffles created by you.",

    when: (s) => s.hostedRaffleCount >= 1000,
  },
];
