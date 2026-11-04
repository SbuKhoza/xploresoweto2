import { Text, View, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, ContactRow, DirectionsButton } from "./shared/detail"
import { DANGER, SUCCESS } from "./shared/theme"

const Healthcare = () => (
  <ExploreList
    collectionName="healthcare"
    title="Healthcare"
    subtitle={"Find nearby\nfacilities"}
    sectionTitle="Healthcare"
    searchPlaceholder="Search clinics, hospitals, etc…"
    noun={{ one: "facility", many: "facilities" }}
    emptyIcon="hospital-building"
    editorialBadges={false}
    getCard={(h) => ({
      extraBadge: h.emergency ? { label: "24/7", icon: "medical", color: DANGER } : null,
      pill: h.hours ? { icon: "time-outline", text: h.hours } : null,
      footer: h.insurance
        ? { icon: "shield-checkmark-outline", text: h.insurance, color: SUCCESS }
        : null,
    })}
    renderDetail={(h, { openDirections, status }) => (
      <>
        <DetailTitle name={h.name} location={h.location} status={status} />

        {!!h.emergency && (
          <View
            className="flex-row items-center bg-danger-light rounded-2xl p-3 mb-3"
            style={{ borderLeftWidth: 4, borderLeftColor: DANGER }}
          >
            <View className="w-9 h-9 rounded-xl bg-white justify-center items-center mr-3">
              <Ionicons name="medical" size={17} color={DANGER} />
            </View>
            <View className="flex-1">
              <Text className="text-[13px] font-extrabold" style={{ color: DANGER }}>24/7 Emergency Services</Text>
              <Text className="text-[11.5px] text-muted mt-0.5">This facility provides round-the-clock emergency care</Text>
            </View>
          </View>
        )}

        <MetaCard
          cells={[
            h.hours ? { icon: "time-outline", text: h.hours, label: "Hours" } : null,
            { rating: h.rating, text: `${h.rating} (${h.reviews})`, label: "Rating" },
            { icon: "shield-checkmark-outline", text: h.insurance || "Contact facility", label: "Insurance" },
          ]}
        />

        {!!h.phone && <ContactRow icon="call" text={h.phone} onPress={() => Linking.openURL(`tel:${h.phone}`)} />}
        {!!h.email && <ContactRow icon="mail" tone="brand" text={h.email} onPress={() => Linking.openURL(`mailto:${h.email}`)} />}

        <DirectionsButton onPress={() => openDirections(h.coordinates, h.name)} />

        {!!h.description && (
          <Section title="About">
            <Text className="text-[13px] text-ink leading-5">{h.description}</Text>
          </Section>
        )}

        {h.specialties?.length > 0 && (
          <Section title="Specialties & Services">
            <Chips items={h.specialties} icon="checkmark" />
          </Section>
        )}
      </>
    )}
  />
)

export default Healthcare
