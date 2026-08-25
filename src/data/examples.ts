export type CogExample =
  | { title: string; url: string; urls?: never; attribution?: string }
  | { title: string; urls: string[]; url?: never; attribution?: string };

export const EXAMPLES: CogExample[] = [
  {
    title:
      "Potential Above-Ground Combustion in Boreal and Arctic North America for SSP585",
    url: "https://data.source.coop/luddaludwig/potential-agc-combustion-ssp585-v0/AGC_final.tif",
  },
  {
    title: "Flood Extent Detection (North Carolina, 2018)",
    url: "https://data.source.coop/nasa/floods/florence_20180919t231350/florence_img_s1a_iw_rt30_20180919t231350_g_gpn_vh.tif",
  },
  {
    title: "Anderson Co. Ortho Pan 2ft (2000)",
    url: "https://data.source.coop/giswqs/tn-imagery/imagery/AndersonCo_OrthoPan_2ft_2000.tif",
  },
  {
    title: "Sentinel-2 True Color (New York, 2024-08-14)",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/TCI.tif",
  },
  {
    title: "New Zealand 2024-2025 10m RGB",
    url: "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff",
  },
  {
    title: "NAIP Aerial (New York, 2022)",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif",
  },
  {
    title: "NLCD Land Cover 2023",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif",
  },
  {
    title: "Sentinel-2 Multi-Band (New York, 2024-08-14) — B04/B03/B02",
    urls: [
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/B04.tif",
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/B03.tif",
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/B02.tif",
    ],
  },
];
