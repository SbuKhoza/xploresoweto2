import { useState } from "react"
import { Text, View } from "react-native"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, DirectionsButton, PrimaryButton, ratingCell } from "./shared/detail"
import { Stars } from "./shared/ui"
import ReservationForm from "./ReservationForm"
import { formatPrice, priceAmount, stayEligibility } from "../../utils/listingData"

// Sort by the single amount a price states ("R700" or 700). A listing with no price, or a range such as "R80 - R150", sorts last in both directions.
const byPrice = (dir) => (a, b) => {
  const x = priceAmount(a.price), y = priceAmount(b.price)
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return dir * (x - y)
}

const Accommodation = () => {
  const [reservationVisible, setReservationVisible] = useState(false)
  const [reservationItem, setReservationItem]       = useState(null)

  const reserve = (item, closeDetail) => {
    closeDetail()
    setReservationItem(item)
    setReservationVisible(true)
  }

  return (
    <>
      <ExploreList
        collectionName="accommodations"
        title="Stay"
        subtitle={"Find your perfect\nplace"}
        sectionTitle="Stay"
        searchPlaceholder="Search places to stay, amenities, etc…"
        noun={{ one: "property", many: "properties" }}
        emptyIcon="bed"
        openNowLabel="Available now"
        extraSorts={[
          { label: "Price: low to high", value: "price-asc",  compare: byPrice(1) },
          { label: "Price: high to low", value: "price-desc", compare: byPrice(-1) },
        ]}
        getCard={(a) => ({
          imageChip: formatPrice(a.price) ? { text: formatPrice(a.price), sub: "/night" } : null,
          pill: a.maxGuests ? { icon: "people-outline", text: `${a.maxGuests} guests` } : null,
        })}
        renderDetail={(a, { closeDetail, openDirections, status }) => (
          <>
            <DetailTitle name={a.name} location={a.location} status={status} />

            {(!!formatPrice(a.price) || !!ratingCell(a)) && (
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4 mb-3 border border-line">
                <View>
                  {!!formatPrice(a.price) && <Text className="text-[20px] font-extrabold text-ink">{formatPrice(a.price)}</Text>}
                  {!!formatPrice(a.price) && <Text className="text-[11px] text-muted mt-0.5">per night</Text>}
                </View>
                {!!ratingCell(a) && (
                  <View className="items-end">
                    <Stars rating={a.rating} size={13} />
                    <Text className="text-[11px] text-muted mt-1">{a.rating}{a.reviews !== null && a.reviews !== undefined ? ` · ${a.reviews} reviews` : ""}</Text>
                  </View>
                )}
              </View>
            )}

            <MetaCard
              cells={[
                a.maxGuests ? { icon: "people-outline", text: `Up to ${a.maxGuests} guests` } : null,
                { icon: "calendar-outline", text: "Min. 1 night" },
              ]}
            />

            <DirectionsButton onPress={() => openDirections(a.coordinates, a.name)} />

            {!!a.description && (
              <Section title="About this place">
                <Text className="text-[13px] text-ink leading-5">{a.description}</Text>
              </Section>
            )}

            {a.amenities.length > 0 && (
              <Section title="Amenities">
                <Chips items={a.amenities} icon="checkmark" />
              </Section>
            )}

            {stayEligibility(a).ok
              ? <PrimaryButton label="Reserve Now" onPress={() => reserve(a, closeDetail)} />
              : <Text className="text-[12.5px] text-muted text-center">{stayEligibility(a).reason}</Text>}
          </>
        )}
      />

      <ReservationForm
        visible={reservationVisible}
        onClose={() => setReservationVisible(false)}
        accommodation={reservationItem}
      />
    </>
  )
}

export default Accommodation
