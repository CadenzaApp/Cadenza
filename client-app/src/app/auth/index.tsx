import { SignInForm } from "@/components/ui/sign-in-form";
import { SignUpForm } from "@/components/ui/sign-up-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

type AuthPageParams = { initialMode: "signup" | "signin" };

export default function AuthPage() {
  const { initialMode } = useLocalSearchParams<AuthPageParams>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { account, signIn, signUp } = useAccount();

  const [tab, setTab] = useState<string>(initialMode ?? "signin");

  function toggleTab(value: string) {
    setTab(value);
    setError(null);
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      if (tab === "signin") {
        await signIn(email, password);
      } else if (tab === "signup") {
        await signUp(email, password);
      }
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  // already logged in
  if (account != null) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      className="bg-background"
      contentContainerClassName="flex-grow px-4 py-8"
      keyboardShouldPersistTaps="handled"
    >
      <Tabs value={tab} onValueChange={toggleTab}>
        <TabsList className="self-center">
          <TabsTrigger value="signin">
            <Text>Sign In</Text>
          </TabsTrigger>
          <TabsTrigger value="signup">
            <Text>Sign Up</Text>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signin">
          <SignInForm
            email={email}
            password={password}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={submit}
            onSwitchMode={() => toggleTab("signup")}
            error={error}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="signup">
          <SignUpForm
            email={email}
            password={password}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={submit}
            onSwitchMode={() => toggleTab("signin")}
            error={error}
            loading={loading}
          />
        </TabsContent>
      </Tabs>
    </ScrollView>
  );
}
