import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { apiKey, page = 1 } = await req.json()

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API-Key fehlt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const res = await fetch(
      `https://aufgemoebelt.prosonata.software/api/v1/projects?page=${page}&per_page=100`,
      {
        headers: {
          'X-API-Key': apiKey.trim(),
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    )

    const text = await res.text()

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `ProSonata API Fehler ${res.status}: ${text}` }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
