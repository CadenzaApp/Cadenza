import { supabase } from "./supabase";
import { useState, useEffect, useRef, createContext, useContext } from "react";
import { createProfile } from "./create-profile";
import { clearSavedReads } from "./saved-reads-store";
import { clearCache } from "./swr-utils";

/**
 * No access token here on purpose. A token expires after about an hour, so
 * anything that needs one asks `getAccessToken()` at request time instead.
 */
type Account = {
    id: string;
    email: string;
    /** When the Cadenza account was made, as an ISO string. */
    createdAt: string;
};

/** if `account == null`, then user isn't logged in */
type AccountInfo = {
    account: Account | null;
    tryRestoreSession: () => Promise<boolean>;
    signIn: (email: string, password: string) => Promise<void>;
    /**
     * Resolves `needsEmailConfirmation: true` when the project makes new
     * accounts confirm their email first. No one is signed in until they do.
     */
    signUp: (
        email: string,
        password: string,
    ) => Promise<{ needsEmailConfirmation: boolean }>;
    signOut: () => Promise<void>;
};

const AccountContext = createContext<AccountInfo | null>(null);

export function useAccount() {
    return useContext(AccountContext)!;
}

type Props = Readonly<{
    children: React.ReactNode;
}>;
export default function AccountProvider({ children }: Props) {
    // written from setAccount, which the auth listener closes over once
    const accountIdRef = useRef<string | null>(null);

    function setAccount(acc: Account | null) {
        const nextId = acc?.id ?? null;
        // the auth listener and tryRestoreSession both report the same
        // session. clearing again drops mounted reads, including the connect
        // step flag, and those reads do not start over
        const changed = nextId !== accountIdRef.current;
        accountIdRef.current = nextId;
        setAccountInfo((prev) => ({
            ...prev,
            account: acc,
        }));
        if (changed) clearCache();
    }

    /**
     * returns `true` if there was an existing session which was restored.
     *
     * this fn is called upon splashscreen render instead of
     * right here in AccountProvider to avoid having to
     * add a "loading" state in the account context.
     *  -  Pages that arent splashscreen and /auth shouldnt have
     *     to worry about if an account is being loaded or not.
     */
    async function tryRestoreSession() {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session != null) {
            setAccount({
                id: data.session.user.id,
                email: data.session.user.email!,
                createdAt: data.session.user.created_at,
            });
            return true;
        }
        return false;
    }

    async function signIn(email: string, password: string) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;

        setAccount({
            id: data.user!.id,
            email: data.user!.email!,
            createdAt: data.user!.created_at,
        });
    }

    async function signUp(email: string, password: string) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) throw error;

        // no session means supabase is waiting on the confirmation email, and
        // a signed in account without a token would 401 on every request
        if (!data.session) return { needsEmailConfirmation: true };

        setAccount({
            id: data.user!.id,
            email: data.user!.email!,
            createdAt: data.user!.created_at,
        });

        // auth.users trigger usually already wrote the row; this covers a
        // missing trigger and ignores ProfileAlreadyExists either way
        try {
            await createProfile(data.session.access_token);
        } catch (profileError) {
            console.warn(
                "Could not create profile after signup:",
                profileError,
            );
        }
        return { needsEmailConfirmation: false };
    }

    async function signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;

        setAccount(null);
        clearCache();
        void clearSavedReads();
    }

    const [accountInfo, setAccountInfo] = useState<AccountInfo>({
        account: null,
        tryRestoreSession,
        signIn,
        signUp,
        signOut,
    });

    // the listener below is registered once, so it cannot read the account off
    // a later render directly. setAccount writes the ref too, before the render
    useEffect(() => {
        accountIdRef.current = accountInfo.account?.id ?? null;
    }, [accountInfo.account?.id]);

    // supabase can end a session on its own, when a refresh fails or the token
    // is revoked. Without this the app keeps rendering a signed in user whose
    // every request comes back 401.
    useEffect(() => {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextId = session?.user.id ?? null;
            if (nextId === accountIdRef.current) return;

            setAccount(
                session
                    ? {
                          id: session.user.id,
                          email: session.user.email!,
                          createdAt: session.user.created_at,
                      }
                    : null,
            );
        });
        return () => data.subscription.unsubscribe();
    }, []);

    return (
        <AccountContext.Provider value={accountInfo}>
            {children}
        </AccountContext.Provider>
    );
}
