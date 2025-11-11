import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET(request: NextRequest) {
  try {
    // Get auth token from Clerk
    const { getToken } = auth();
    const token = await getToken();

    if (!token) {
      return NextResponse.redirect(
        new URL('/sign-in?error=unauthorized', request.url)
      );
    }

    // Extract OAuth callback parameters
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle OAuth error
    if (error) {
      console.error('OAuth error:', error);
      return NextResponse.redirect(
        new URL(
          `/connectors?error=${encodeURIComponent(error)}`,
          request.url
        )
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/connectors?error=missing_params', request.url)
      );
    }

    // Parse state to get provider
    let provider: string;
    try {
      const stateData = JSON.parse(atob(state));
      provider = stateData.provider;
    } catch (e) {
      console.error('Failed to parse state:', e);
      return NextResponse.redirect(
        new URL('/connectors?error=invalid_state', request.url)
      );
    }

    // Call backend API to complete OAuth flow
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const apiResponse = await fetch(
      `${apiUrl}/api/connectors/${provider}/callback?code=${encodeURIComponent(
        code
      )}&state=${encodeURIComponent(state)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json();
      console.error('API callback error:', errorData);
      return NextResponse.redirect(
        new URL(
          `/connectors?error=${encodeURIComponent(
            errorData.error?.message || 'callback_failed'
          )}`,
          request.url
        )
      );
    }

    // Successful connection
    return NextResponse.redirect(
      new URL('/connectors?success=connected', request.url)
    );
  } catch (error) {
    console.error('Callback handler error:', error);
    return NextResponse.redirect(
      new URL('/connectors?error=server_error', request.url)
    );
  }
}
