import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Text } from "@/components/ui/text";
import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  type TextInput,
  View,
} from "react-native";

type SignInFormProps = {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onSwitchMode?: () => void;
  error?: any;
  loading?: boolean;
};

export function SignInForm({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onSwitchMode,
  error,
  loading = false,
}: SignInFormProps) {
  const passwordInputRef = React.useRef<TextInput>(null);

  function onEmailSubmitEditing() {
    passwordInputRef.current?.focus();
  }

  return (
    <View className="gap-6">
      <Card className="border-border/0 bg-card-background sm:border-border shadow-none sm:shadow-sm sm:shadow-black/5">
        <CardHeader>
          <CardTitle className="text-center text-xl sm:text-left">
            Sign in to Cadenza
          </CardTitle>
          <CardDescription className="text-center sm:text-left">
            Welcome back! Please sign in to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-6">
          <View className="gap-6">
            <View className="gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                placeholder="m@example.com"
                keyboardType="email-address"
                autoComplete="email"
                autoCapitalize="none"
                value={email}
                onChangeText={onEmailChange}
                onSubmitEditing={onEmailSubmitEditing}
                returnKeyType="next"
                submitBehavior="submit"
                editable={!loading}
              />
            </View>
            <View className="gap-1.5">
              <View className="flex-row items-center">
                <Label htmlFor="password">Password</Label>

                {/* Forgot password button. Disabling for now. */}
                {/*<Button
                  variant="link"
                  size="sm"
                  className="web:h-fit ml-auto h-4 px-1 py-0 sm:h-4"
                  onPress={() => {
                    // TODO: Navigate to forgot password screen
                  }}
                >
                  <Text className="font-normal leading-4">
                    Forgot your password?
                  </Text>
                </Button>*/}
              </View>
              <Input
                ref={passwordInputRef}
                id="password"
                secureTextEntry
                value={password}
                onChangeText={onPasswordChange}
                returnKeyType="send"
                onSubmitEditing={onSubmit}
                editable={!loading}
              />
            </View>

            {error != null && (
              <Text className="text-destructive text-sm">
                {typeof error === "string"
                  ? error
                  : (error?.message ?? JSON.stringify(error))}
              </Text>
            )}

            <Button className="w-full" onPress={onSubmit} disabled={loading}>
              {loading ? <ActivityIndicator /> : <Text>Continue</Text>}
            </Button>
          </View>
          <Text className="text-center text-sm">
            Don&apos;t have an account?{" "}
            <Pressable onPress={onSwitchMode}>
              <Text className="text-sm underline underline-offset-4">
                Sign up
              </Text>
            </Pressable>
          </Text>
        </CardContent>
      </Card>
    </View>
  );
}
