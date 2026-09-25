import { supabase } from "./supabase";
import { useState, useEffect, useRef, createContext, useContext } from "react";
import { clearCache } from "./swr-utils";

/**
 * No access token here on purpose. A token expires after about an hour, so
 * anything that needs one asks `getAccessToken()` at request time instead.
 */
type Account = {
    id: string;
    email: string;
};

/** if `account == null`, then user isn't logged in */
type AccountInfo = {
    account: Account | null;
    tryRestoreSession: () => Promise<boolean>;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
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
    function setAccount(acc: Account | null) {
        setAccountInfo((prev) => ({
            ...prev,
            account: acc,
        }));
        clearCache();
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
        });
    }

    async function signUp(email: string, password: string) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) throw error;

        setAccount({
            id: data.user!.id,
            email: data.user!.email!,
        });
    }

    async function signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;

        setAccount(null);
        clearCache();
    }

    const [accountInfo, setAccountInfo] = useState<AccountInfo>({
        account: null,
        tryRestoreSession,
        signIn,
        signUp,
        signOut,
    });

    // the listener below is registered once, so it cannot read the account off
    // a later render directly
    const accountIdRef = useRef<string | null>(null);
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
                    ? { id: session.user.id, email: session.user.email! }
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
