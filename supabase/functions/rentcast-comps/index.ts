Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RENTCAST_API_KEY = Deno.env.get("RENTCAST_API_KEY");
    if (!RENTCAST_API_KEY) {
      throw new Error("RENTCAST_API_KEY not configured");
    }

    const body = await req.json() as { address: string; propertyType?: string };
    const address = body.address;
    if (!address) {
      throw new Error("Property address is required");
    }

    const encodedAddress = encodeURIComponent(address);
    const propertyType = body.propertyType || "Single Family";
    const encodedType = encodeURIComponent(propertyType);

    console.log("Fetching RentCast data for:", address);

    // Fetch sale comps and value estimate
    const saleRes = await fetch(
      `https://api.rentcast.io/v1/avm/value?address=${encodedAddress}&propertyType=${encodedType}`,
      {
        headers: {
          "X-Api-Key": RENTCAST_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    // Fetch rental comps and rent estimate
    const rentRes = await fetch(
      `https://api.rentcast.io/v1/avm/rent/long-term?address=${encodedAddress}&propertyType=${encodedType}`,
      {
        headers: {
          "X-Api-Key": RENTCAST_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    let saleData: Record<string, unknown> = {};
    let rentData: Record<string, unknown> = {};

    if (saleRes.ok) {
      saleData = await saleRes.json() as Record<string, unknown>;
      console.log("Sale data received, price:", (saleData as { price?: number }).price);
    } else {
      const err = await saleRes.text();
      console.error("Sale API error:", saleRes.status, err);
    }

    if (rentRes.ok) {
      rentData = await rentRes.json() as Record<string, unknown>;
      console.log("Rent data received, estimate:", (rentData as { rent?: number }).rent);
    } else {
      const err = await rentRes.text();
      console.error("Rent API error:", rentRes.status, err);
    }

    // Parse sale comps
    interface RentcastComp {
      id?: string;
      formattedAddress?: string;
      price?: number;
      squareFootage?: number;
      bedrooms?: number;
      bathrooms?: number;
      daysOnMarket?: number;
      listedDate?: string;
      soldDate?: string;
      distance?: number;
      correlation?: number;
    }

    const rawComps = (saleData as { comparables?: RentcastComp[] }).comparables || [];
    const saleComps = rawComps.slice(0, 6).map((c: RentcastComp) => ({
      address: c.formattedAddress || "",
      salePrice: c.price || 0,
      sqft: c.squareFootage || 0,
      bedBath: `${c.bedrooms || 0}/${c.bathrooms || 0}`,
      daysOnMarket: c.daysOnMarket || 0,
      soldDate: c.soldDate || c.listedDate || "",
      strength: (c.correlation && c.correlation > 0.8 ? "strong" : c.correlation && c.correlation > 0.5 ? "average" : "weak") as "strong" | "average" | "weak",
      notes: `RentCast comp${c.distance ? ` · ${c.distance.toFixed(2)} miles away` : ""}`,
    }));

    // Parse rental comps
    interface RentcastRentalComp {
      formattedAddress?: string;
      price?: number;
      bedrooms?: number;
      bathrooms?: number;
      distance?: number;
    }

    const rawRentalComps = (rentData as { comparables?: RentcastRentalComp[] }).comparables || [];
    const rentalComps = rawRentalComps.slice(0, 5).map((c: RentcastRentalComp) => ({
      address: c.formattedAddress || "",
      monthlyRent: c.price || 0,
      bedBath: `${c.bedrooms || 0}/${c.bathrooms || 0}`,
      distance: c.distance ? `${c.distance.toFixed(2)} mi` : "",
    }));

    return new Response(
      JSON.stringify({
        success: true,
        valueEstimate: (saleData as { price?: number }).price || 0,
        rentEstimate: (rentData as { rent?: number }).rent || 0,
        saleComps,
        rentalComps,
        priceRangeLow: (saleData as { priceLow?: number }).priceLow || 0,
        priceRangeHigh: (saleData as { priceHigh?: number }).priceHigh || 0,
        rentRangeLow: (rentData as { rentRangeLow?: number }).rentRangeLow || 0,
        rentRangeHigh: (rentData as { rentRangeHigh?: number }).rentRangeHigh || 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("rentcast-comps error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
